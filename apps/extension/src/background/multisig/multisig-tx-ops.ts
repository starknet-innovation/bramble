/**
 * Transaction-submitting multisig operations: propose, confirm, revoke,
 * execute, deploy a new multisig through the Universal Deployer Contract,
 * and declare the pinned multisig class when a network lacks it. Every
 * submission goes through the shared verified invoke path with an explicitly
 * selected vault account; the multisig contract re-checks signer membership
 * and quorum on-chain, so these handlers can never bypass it. The resolution,
 * recipient-policy, submission, and status plumbing they compose lives in
 * ./multisig-tx-context.
 */
import {
  buildMultisigConfirmCall,
  buildMultisigExecuteCall,
  buildMultisigRevokeCall,
  buildMultisigSubmitCall,
  confirmationCompletesQuorum,
  type MultisigCallInput,
  type MultisigProposalStatus,
} from "@mc-wallet/multisig/chain";
import { multisigProposalId } from "@mc-wallet/multisig/repository";
import { signerForContext } from "../accounts/wallet-ops";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { handleMultisigDeployOps } from "./multisig-deploy-ops";
import {
  type ConfirmMultisigProposalInput,
  readConfirmMultisigProposalInput,
  readMultisigProposalActionInput,
  readProposeMultisigInput,
} from "./multisig-inputs";
import {
  buildMultisigProposalRecord,
  defaultSummary,
  type MultisigOpsDeps,
  multisigRpc,
} from "./multisig-ops";
import {
  confirmGuard,
  executableCall,
  revokeGuard,
  revokeRecordGuardError,
} from "./multisig-proposal-guards";
import {
  freshProposalStatus,
  type ProposalActionPlan,
  proposalById,
  type ResolvedProposal,
  recordGuardError,
  refreshAfterAction,
  refusePoisonedProposalRecipient,
  requiredMultisigFeeReview,
  reserveProposalAction,
  resolveMultisigTarget,
  submitAndRecord,
  submitClaimedAndRecord,
} from "./multisig-tx-context";

type MultisigTxHandler = (deps: MultisigOpsDeps, message: unknown) => Promise<RuntimeResponse>;

// The recipient gate for a proposal whose inner call is already stored. Every
// action that would advance that call — co-signing it or executing it — applies
// the same policy the proposer applied, because the stored call was proposed by
// another signer and this wallet re-decides for itself what it is willing to
// broadcast. Revocation is deliberately never gated: withdrawing a confirmation
// from a poisoned proposal must always stay possible.
const refuseStoredProposalRecipient = async (
  deps: MultisigOpsDeps,
  found: ResolvedProposal,
): Promise<{ readonly error: string } | null> =>
  found.proposal.call
    ? refusePoisonedProposalRecipient(deps, found.resolved, found.proposal.call)
    : null;

const proposeMultisigTx: MultisigTxHandler = async (deps, message) => {
  const input = readProposeMultisigInput(message);
  if (!input) {
    return { error: "invalid propose request" };
  }
  const target = await resolveMultisigTarget(deps, input.multisigId, input.signerAccountId);
  if ("error" in target) {
    return { error: target.error };
  }
  const call: MultisigCallInput = {
    calldata: input.calldata,
    contractAddress: input.to,
    entrypoint: input.entrypoint,
  };
  // Verified BEFORE the proposal id is derived and long before the submit
  // transaction is broadcast, so a poisoned recipient never becomes a stored
  // proposal other signers are asked to co-sign.
  const refusal = await refusePoisonedProposalRecipient(deps, target, call);
  if (refusal) {
    return refusal;
  }
  const txId = await multisigRpc(deps).computeTransactionId({
    address: target.record.address,
    call,
    rpcUrls: target.rpcUrls,
    salt: input.salt,
  });
  const id = multisigProposalId(target.record.id, txId);
  if (!id) {
    return { error: "invalid propose request" };
  }
  const summary = defaultSummary(input);
  const calls = [buildMultisigSubmitCall(target.record.address, call, input.salt)];
  if (!input.reviewedFee) {
    return requiredMultisigFeeReview(deps, target, calls);
  }
  const transactionHash = await submitAndRecord(
    deps,
    target,
    calls,
    `Propose: ${summary}`,
    input.reviewedFee,
  );
  const proposal = buildMultisigProposalRecord({
    id,
    input,
    multisigId: target.record.id,
    submitTransactionHash: transactionHash,
    summary,
    txId,
  });
  await deps.multisigStore.upsertProposal(proposal).catch(() => undefined);
  // No post-broadcast status refresh here: the submit transaction cannot be
  // mined yet, so the chain would answer not-found for a proposal that was
  // just optimistically stored as pending.
  return { ok: true, proposal, transactionHash };
};

// The atomic mode is allowed only when this confirmation reaches quorum. The
// contract sees confirm's storage write before execute; a failed execution
// reverts both calls, which is why the mode remains explicit.
const planConfirm = (
  found: ResolvedProposal,
  status: MultisigProposalStatus,
  input: ConfirmMultisigProposalInput,
): ProposalActionPlan | { readonly error: string } => {
  const { record } = found.resolved;
  const confirmCall = buildMultisigConfirmCall(record.address, found.proposal.txId);
  if (input.mode === "confirm-only") {
    return { calls: [confirmCall], summary: `Confirm: ${found.proposal.summary}` };
  }
  const executable = executableCall(
    found.proposal,
    "call, so confirm it here and execute from the wallet that proposed it",
  );
  if ("error" in executable) return executable;
  if (
    !confirmationCompletesQuorum({
      confirmations: status.confirmations,
      quorum: record.quorum,
      signerHasConfirmed: status.confirmedBySigner,
      state: status.state,
    })
  ) {
    return {
      error: `this confirmation does not reach quorum (${status.confirmations + 1} of ${record.quorum}), so it cannot execute yet — confirm without executing`,
    };
  }
  return {
    calls: [confirmCall, buildMultisigExecuteCall(record.address, executable, executable.salt)],
    executed: executable,
    summary: `Confirm and execute: ${found.proposal.summary}`,
  };
};

type ConfirmationContext = {
  readonly found: ResolvedProposal;
  readonly input: ConfirmMultisigProposalInput;
  readonly plan: ProposalActionPlan;
};

const confirmationContext = async (
  deps: MultisigOpsDeps,
  message: unknown,
  type: "wallet.confirmMultisigProposal" | "wallet.prepareMultisigConfirmation",
): Promise<{ readonly error: string } | ConfirmationContext> => {
  const input = readConfirmMultisigProposalInput(message, type);
  if (!input) return { error: "invalid confirm request" };
  const found = await proposalById(deps, input.proposalId, input.signerAccountId);
  if ("error" in found) return found;
  // Before any chain read or fee estimate: a confirmation names the stored
  // txId, so an unbound record must not reach `planConfirm` in either mode.
  const recordError = recordGuardError(found.proposal, input.untrackedVerified);
  if (recordError) return { error: recordError };
  // Applied to the review as well as the submission, so the panel never shows a
  // fee estimate for a payment this wallet would refuse to co-sign.
  const refusal = await refuseStoredProposalRecipient(deps, found);
  if (refusal) return refusal;
  const status = await freshProposalStatus(deps, found);
  if ("error" in status) return status;
  const guardError = confirmGuard(status);
  if (guardError) return { error: guardError };
  const plan = planConfirm(found, status, input);
  return "error" in plan ? plan : { found, input, plan };
};

const prepareMultisigConfirmation: MultisigTxHandler = async (deps, message) => {
  const context = await confirmationContext(deps, message, "wallet.prepareMultisigConfirmation");
  if ("error" in context) return context;
  const fee = await deps.runtimeRpc
    .estimateInvokeFee({
      account: context.found.resolved.account.account,
      calls: context.plan.calls,
      rpcUrls: context.found.resolved.rpcUrls,
      signHash: signerForContext(deps, context.found.resolved.account),
    })
    .catch(() => null);
  return {
    confirmationReview: {
      fee,
      feeEstimateFailed: fee === null,
      mode: context.input.mode,
      proposalId: context.input.proposalId,
      signerAccountId: context.found.resolved.account.account.id,
    },
    ok: true,
  };
};

const confirmMultisigProposal: MultisigTxHandler = async (deps, message) => {
  const context = await confirmationContext(deps, message, "wallet.confirmMultisigProposal");
  if ("error" in context) return context;
  if (!context.input.reviewedFee) {
    return requiredMultisigFeeReview(deps, context.found.resolved, context.plan.calls);
  }
  const claim = await reserveProposalAction(deps, context.found, "confirm");
  if ("error" in claim) return claim;
  const transactionHash = await submitClaimedAndRecord(
    deps,
    context.found.resolved,
    context.plan,
    claim.operationId,
    // The figure `prepareMultisigConfirmation` returned for these same calls,
    // echoed back by the panel: co-signing is the step that actually spends the
    // signer's STRK, so it is bound to the fee they read (MCW-V09-119).
    context.input.reviewedFee,
  );
  await refreshAfterAction(deps, context.found).catch(() => undefined);
  return { ok: true, transactionHash };
};

const revokeMultisigConfirmation: MultisigTxHandler = async (deps, message) => {
  const input = readMultisigProposalActionInput(message, "wallet.revokeMultisigConfirmation");
  if (!input) return { error: "invalid revoke request" };
  const found = await proposalById(deps, input.proposalId, input.signerAccountId);
  if ("error" in found) return found;
  // A revocation names the stored txId, but its calldata is that id alone and
  // it only ever REMOVES this signer's authority — so an unbound record is not
  // refused here the way confirm and execute refuse it. It takes the explicit
  // acknowledgment instead, which is the only way a legacy poisoned record's
  // confirmation can still be withdrawn. The fresh-status gate below is what
  // bounds that path: it must be an id the chain says this signer confirmed.
  const recordError = revokeRecordGuardError(found.proposal, input.untrackedVerified);
  if (recordError) return { error: recordError };
  const status = await freshProposalStatus(deps, found);
  if ("error" in status) return status;
  const guardError = revokeGuard(status);
  if (guardError) return { error: guardError };
  const plan = {
    calls: [buildMultisigRevokeCall(found.resolved.record.address, found.proposal.txId)],
    summary: `Revoke confirmation: ${found.proposal.summary}`,
  };
  if (!input.reviewedFee) {
    return requiredMultisigFeeReview(deps, found.resolved, plan.calls);
  }
  const claim = await reserveProposalAction(deps, found, "revoke");
  if ("error" in claim) return claim;
  const transactionHash = await submitClaimedAndRecord(
    deps,
    found.resolved,
    plan,
    claim.operationId,
    input.reviewedFee,
  );
  await refreshAfterAction(deps, found).catch(() => undefined);
  return { ok: true, transactionHash };
};

const executeMultisigProposal: MultisigTxHandler = async (deps, message) => {
  const input = readMultisigProposalActionInput(message, "wallet.executeMultisigProposal");
  if (!input) return { error: "invalid execute request" };
  const found = await proposalById(deps, input.proposalId, input.signerAccountId);
  if ("error" in found) return found;
  const executable = executableCall(
    found.proposal,
    "call, so execute it from the wallet that proposed it",
  );
  if ("error" in executable) return executable;
  // The last gate before the multisig runs the inner call: this wallet is the
  // one broadcasting it, so the recipient policy applies here exactly as it does
  // to a public send, whoever proposed it.
  const refusal = await refusePoisonedProposalRecipient(deps, found.resolved, executable);
  if (refusal) return refusal;
  const status = await freshProposalStatus(deps, found);
  if ("error" in status) {
    return status;
  }
  if (status.state !== "confirmed") {
    return { error: `cannot execute a proposal that is ${status.state}` };
  }
  const plan = {
    calls: [buildMultisigExecuteCall(found.resolved.record.address, executable, executable.salt)],
    executed: executable,
    summary: `Execute: ${found.proposal.summary}`,
  };
  if (!input.reviewedFee) {
    return requiredMultisigFeeReview(deps, found.resolved, plan.calls);
  }
  const claim = await reserveProposalAction(deps, found, "execute");
  if ("error" in claim) return claim;
  const transactionHash = await submitClaimedAndRecord(
    deps,
    found.resolved,
    plan,
    claim.operationId,
    input.reviewedFee,
  );
  await refreshAfterAction(deps, found).catch(() => undefined);
  return { ok: true, transactionHash };
};

// One handler per transaction-submitting multisig message type; the router
// below is a single map lookup and unknown types fall through to null.
const TX_HANDLERS: Record<string, MultisigTxHandler> = {
  "wallet.confirmMultisigProposal": confirmMultisigProposal,
  "wallet.executeMultisigProposal": executeMultisigProposal,
  "wallet.prepareMultisigConfirmation": prepareMultisigConfirmation,
  "wallet.proposeMultisigTx": proposeMultisigTx,
  "wallet.revokeMultisigConfirmation": revokeMultisigConfirmation,
};

/**
 * Handles transaction-submitting multisig messages; returns null for other
 * message types.
 */
export const handleMultisigTxOps = async (
  deps: MultisigOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const handler = Object.hasOwn(TX_HANDLERS, messageType) ? TX_HANDLERS[messageType] : undefined;
  return handler ? handler(deps, message) : handleMultisigDeployOps(deps, messageType, message);
};
