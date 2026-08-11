/**
 * Transaction-submitting multisig operations: propose, confirm, revoke,
 * execute, deploy a new multisig through the Universal Deployer Contract,
 * and declare the pinned multisig class when a network lacks it. Every
 * submission goes through the shared verified invoke path with an explicitly
 * selected vault account; the multisig contract re-checks signer membership
 * and quorum on-chain, so these handlers can never bypass it.
 */
import type { Call } from "starknet";
import type { LedgerSignIntent } from "@mc-wallet/ledger-protocol/intent";
import {
  buildMultisigConfirmCall,
  buildMultisigExecuteCall,
  buildMultisigRevokeCall,
  buildMultisigSubmitCall,
  confirmationCompletesQuorum,
  type MultisigCallInput,
  type MultisigProposalStatus,
} from "@mc-wallet/multisig/chain";
import { type MultisigProposalRecord, multisigProposalId } from "@mc-wallet/multisig/repository";
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
  type MultisigContext,
  type MultisigOpsDeps,
  multisigContext,
  multisigRpc,
  refreshSignerMembership,
} from "./multisig-ops";
import {
  confirmedSignersAfterStatus,
  confirmGuard,
  isProposalSubmitPending,
  revokeGuard,
} from "./multisig-proposal-status";
import {
  claimMultisigProposalOperation,
  type MultisigProposalOperationKind,
  recordClaimedMultisigSubmission,
  recordSubmittedActivity,
  releaseMultisigOperation,
} from "./multisig-submission";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { signerForContext } from "../accounts/wallet-ops";

type MultisigTxHandler = (deps: MultisigOpsDeps, message: unknown) => Promise<RuntimeResponse>;

type ResolvedProposal = {
  readonly proposal: MultisigProposalRecord;
  readonly resolved: MultisigContext;
};

// Resolves the selected signer + watched record and re-proves signer membership
// in one step. Every signer-gated submission runs this first so stale registry
// data can never offer a transaction the chain would reject.
const resolveMultisigTarget = async (
  deps: MultisigOpsDeps,
  id: string,
  signerAccountId?: string,
): Promise<{ readonly error: string } | MultisigContext> => {
  const resolved = await multisigContext(deps, id, signerAccountId);
  if ("error" in resolved) {
    return { error: resolved.error };
  }
  return refreshSignerMembership(deps, resolved);
};

// Submits one or more calls as a single invoke through the shared path and
// records activity. The caller's descriptive summary is recorded verbatim: the
// generic call decoder cannot describe multisig entrypoints, and the dedup
// guards below match on these summaries, so they must stay deterministic and
// specific. Batched calls share one transaction, so they succeed or revert
// together.
const submitAndRecord = async (
  deps: MultisigOpsDeps,
  resolved: MultisigContext,
  calls: readonly Call[],
  summary: string,
  intent: LedgerSignIntent,
): Promise<string> => {
  const result = await deps.runtimeRpc.submitInvokeTransaction({
    account: resolved.account.account,
    calls,
    rpcUrls: resolved.rpcUrls,
    signHash: signerForContext(deps, resolved.account, intent),
  });
  await recordSubmittedActivity(deps.activity, {
    accountId: resolved.record.id,
    hash: result.transactionHash,
    kind: "invoke",
    networkId: resolved.account.networkId,
    summary,
  });
  return result.transactionHash;
};

const submitClaimedAndRecord = async (
  deps: MultisigOpsDeps,
  resolved: MultisigContext,
  calls: readonly Call[],
  summary: string,
  operationId: string,
  intent: LedgerSignIntent,
): Promise<string> => {
  let result: { readonly transactionHash: string };
  try {
    result = await deps.runtimeRpc.submitInvokeTransaction({
      account: resolved.account.account,
      calls,
      rpcUrls: resolved.rpcUrls,
      signHash: signerForContext(deps, resolved.account, intent),
    });
  } catch (error) {
    await releaseMultisigOperation(deps, operationId);
    throw error;
  }
  await recordClaimedMultisigSubmission(deps, operationId, {
    accountId: resolved.record.id,
    hash: result.transactionHash,
    kind: "invoke",
    networkId: resolved.account.networkId,
    summary,
  });
  return result.transactionHash;
};

const proposalById = async (
  deps: MultisigOpsDeps,
  proposalId: string,
  signerAccountId?: string,
): Promise<{ readonly error: string } | ResolvedProposal> => {
  const proposal = (await deps.multisigStore.listProposals()).find(
    (stored) => stored.id === proposalId,
  );
  if (!proposal) {
    return { error: "proposal not found" };
  }
  const resolved = await resolveMultisigTarget(deps, proposal.multisigId, signerAccountId);
  if ("error" in resolved) {
    return { error: resolved.error };
  }
  return { proposal, resolved };
};

const requireUntrackedVerification = (
  proposal: MultisigProposalRecord,
  untrackedVerified: boolean | undefined,
): string | null =>
  proposal.call === null && untrackedVerified !== true
    ? "verify this proposal on a block explorer or with the proposer, then acknowledge before confirming"
    : null;

// A wallet-submitted proposal reading as not-found is kept only while its submit
// transaction is still pending. Once that submit is accepted/rejected, not-found
// is the authoritative chain state and should be persisted.
const persistFreshStatus = async (
  deps: MultisigOpsDeps,
  proposal: MultisigProposalRecord,
  status: MultisigProposalStatus,
  signer: string,
): Promise<void> => {
  if (status.state === "not-found" && (await isProposalSubmitPending(deps, proposal))) {
    return;
  }
  await deps.multisigStore.upsertProposal({
    ...proposal,
    confirmations: status.confirmations,
    confirmedBySigner: status.confirmedBySigner,
    confirmedBySignerAddress: signer,
    confirmedSignerAddresses: confirmedSignersAfterStatus(
      proposal,
      signer,
      status.confirmedBySigner,
    ),
    state: status.state,
  });
};

const refreshAfterAction = async (
  deps: MultisigOpsDeps,
  found: ResolvedProposal,
): Promise<void> => {
  const status = await multisigRpc(deps)
    .getProposalStatus({
      address: found.resolved.record.address,
      rpcUrls: found.resolved.rpcUrls,
      signer: found.resolved.account.account.address,
      txId: found.proposal.txId,
    })
    .catch(() => null);
  if (status) {
    await persistFreshStatus(deps, found.proposal, status, found.resolved.account.account.address);
  }
};

const freshProposalStatus = async (
  deps: MultisigOpsDeps,
  found: ResolvedProposal,
): Promise<{ readonly error: string } | MultisigProposalStatus> => {
  let status: MultisigProposalStatus;
  try {
    status = await multisigRpc(deps).getProposalStatus({
      address: found.resolved.record.address,
      rpcUrls: found.resolved.rpcUrls,
      signer: found.resolved.account.account.address,
      txId: found.proposal.txId,
    });
  } catch {
    return { error: "could not refresh proposal status — try again" };
  }
  await persistFreshStatus(deps, found.proposal, status, found.resolved.account.account.address);
  return status;
};

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
  const transactionHash = await submitAndRecord(
    deps,
    target,
    [buildMultisigSubmitCall(target.record.address, call, input.salt)],
    `Propose: ${summary}`,
    "multisig-propose",
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

// What one proposal action will broadcast: the calls for a single invoke plus
// the activity summary describing them.
type ProposalActionPlan = {
  readonly calls: readonly Call[];
  readonly summary: string;
};

const reserveProposalAction = async (
  deps: MultisigOpsDeps,
  found: ResolvedProposal,
  kind: MultisigProposalOperationKind,
): Promise<{ readonly error: string } | { readonly operationId: string }> =>
  claimMultisigProposalOperation(deps, {
    accountId: found.resolved.account.account.id,
    kind,
    networkId: found.resolved.account.networkId,
    pendingError: "this signer already has a proposal action in progress — wait for it to settle",
    txId: found.proposal.txId,
  });

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
  const proposalCall = found.proposal.call;
  if (!proposalCall) {
    return {
      error:
        "this proposal was tracked by id only; executing needs the original call, so confirm it here and execute from the wallet that proposed it",
    };
  }
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
    calls: [
      confirmCall,
      buildMultisigExecuteCall(
        record.address,
        {
          calldata: proposalCall.calldata,
          contractAddress: proposalCall.contractAddress,
          entrypoint: proposalCall.entrypoint,
        },
        proposalCall.salt,
      ),
    ],
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
  const verifyError = requireUntrackedVerification(found.proposal, input.untrackedVerified);
  if (verifyError) return { error: verifyError };
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
      signHash: signerForContext(deps, context.found.resolved.account, "multisig-confirm"),
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
  const claim = await reserveProposalAction(deps, context.found, "confirm");
  if ("error" in claim) return claim;
  const transactionHash = await submitClaimedAndRecord(
    deps,
    context.found.resolved,
    context.plan.calls,
    context.plan.summary,
    claim.operationId,
    // Atomic confirm-and-execute is still labelled as a confirmation: it is the
    // action the user chose, and both calls ride on the one device approval.
    "multisig-confirm",
  );
  await refreshAfterAction(deps, context.found).catch(() => undefined);
  return { ok: true, transactionHash };
};

const revokeMultisigConfirmation: MultisigTxHandler = async (deps, message) => {
  const input = readMultisigProposalActionInput(message, "wallet.revokeMultisigConfirmation");
  if (!input) return { error: "invalid revoke request" };
  const found = await proposalById(deps, input.proposalId, input.signerAccountId);
  if ("error" in found) return found;
  const verifyError = requireUntrackedVerification(found.proposal, input.untrackedVerified);
  if (verifyError) return { error: verifyError };
  const status = await freshProposalStatus(deps, found);
  if ("error" in status) return status;
  const guardError = revokeGuard(status);
  if (guardError) return { error: guardError };
  const claim = await reserveProposalAction(deps, found, "revoke");
  if ("error" in claim) return claim;
  const transactionHash = await submitClaimedAndRecord(
    deps,
    found.resolved,
    [buildMultisigRevokeCall(found.resolved.record.address, found.proposal.txId)],
    `Revoke confirmation: ${found.proposal.summary}`,
    claim.operationId,
    "multisig-revoke",
  );
  await refreshAfterAction(deps, found).catch(() => undefined);
  return { ok: true, transactionHash };
};

const executeMultisigProposal: MultisigTxHandler = async (deps, message) => {
  const input = readMultisigProposalActionInput(message, "wallet.executeMultisigProposal");
  if (!input) return { error: "invalid execute request" };
  const found = await proposalById(deps, input.proposalId, input.signerAccountId);
  if ("error" in found) return found;
  const proposalCall = found.proposal.call;
  if (!proposalCall) {
    return {
      error:
        "this proposal was tracked by id only; executing needs the original call, so execute it from the wallet that proposed it",
    };
  }
  const status = await freshProposalStatus(deps, found);
  if ("error" in status) {
    return status;
  }
  if (status.state !== "confirmed") {
    return { error: `cannot execute a proposal that is ${status.state}` };
  }
  const claim = await reserveProposalAction(deps, found, "execute");
  if ("error" in claim) return claim;
  const transactionHash = await submitClaimedAndRecord(
    deps,
    found.resolved,
    [
      buildMultisigExecuteCall(
        found.resolved.record.address,
        {
          calldata: proposalCall.calldata,
          contractAddress: proposalCall.contractAddress,
          entrypoint: proposalCall.entrypoint,
        },
        proposalCall.salt,
      ),
    ],
    `Execute: ${found.proposal.summary}`,
    claim.operationId,
    "multisig-execute",
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
  const handler = TX_HANDLERS[messageType];
  return handler ? handler(deps, message) : handleMultisigDeployOps(deps, messageType, message);
};
