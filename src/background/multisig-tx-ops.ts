/**
 * Transaction-submitting multisig operations: propose, confirm, revoke,
 * execute, deploy a new multisig through the Universal Deployer Contract,
 * and declare the pinned multisig class when a network lacks it. Every
 * submission goes through the shared verified invoke path with the active
 * account's session signer; the multisig contract re-checks signer membership
 * and quorum on-chain, so these handlers can never bypass it. Each message
 * type maps to one small async handler; the exported router is a single
 * dispatch-map lookup.
 */
import type { Call } from "starknet";
import {
  buildMultisigConfirmCall,
  buildMultisigExecuteCall,
  buildMultisigRevokeCall,
  buildMultisigSubmitCall,
  confirmationCompletesQuorum,
  type MultisigCallInput,
  type MultisigProposalStatus,
} from "../starknet/multisig";
import { type MultisigProposalRecord, multisigProposalId } from "../storage/multisig-store";
import { handleMultisigDeployOps } from "./multisig-deploy-ops";
import {
  type MultisigProposalActionInput,
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
import { confirmedSignersAfterStatus, isProposalSubmitPending } from "./multisig-proposal-status";
import { recordSubmittedActivity } from "./multisig-submission";
import type { RuntimeResponse } from "./runtime-types";
import { signerForContext } from "./wallet-ops";

/**
 * One handler per transaction-submitting multisig message type.
 */
type MultisigTxHandler = (deps: MultisigOpsDeps, message: unknown) => Promise<RuntimeResponse>;

/**
 * A watched multisig resolved on the active network plus a stored proposal.
 */
type ResolvedProposal = {
  readonly proposal: MultisigProposalRecord;
  readonly resolved: MultisigContext;
};

// Resolves the active account + watched record and re-proves signer membership
// in one step. Every signer-gated submission runs this first so stale registry
// data can never offer a transaction the chain would reject.
const resolveMultisigTarget = async (
  deps: MultisigOpsDeps,
  id: string,
): Promise<{ readonly error: string } | MultisigContext> => {
  const resolved = await multisigContext(deps, id);
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
): Promise<string> => {
  const result = await deps.runtimeRpc.submitInvokeTransaction({
    account: resolved.account.account,
    calls,
    rpcUrls: resolved.rpcUrls,
    signHash: signerForContext(deps, resolved.account),
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

const proposalById = async (
  deps: MultisigOpsDeps,
  proposalId: string,
): Promise<{ readonly error: string } | ResolvedProposal> => {
  const proposal = (await deps.multisigStore.listProposals()).find(
    (stored) => stored.id === proposalId,
  );
  if (!proposal) {
    return { error: "proposal not found" };
  }
  const resolved = await resolveMultisigTarget(deps, proposal.multisigId);
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
  const target = await resolveMultisigTarget(deps, input.multisigId);
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

// Shared confirm/revoke flow: parse, resolve, enforce untracked-acknowledgement,
// refresh status, run the state-specific guard, then plan, submit, and record.
// The plan runs after the fresh chain read so it can decide on real state.
const runProposalAction = async (
  deps: MultisigOpsDeps,
  message: unknown,
  type: "wallet.confirmMultisigProposal" | "wallet.revokeMultisigConfirmation",
  invalidError: string,
  guard: (status: MultisigProposalStatus) => string | null,
  plan: (
    found: ResolvedProposal,
    status: MultisigProposalStatus,
    input: MultisigProposalActionInput,
  ) => ProposalActionPlan | { readonly error: string },
): Promise<RuntimeResponse> => {
  const input = readMultisigProposalActionInput(message, type);
  if (!input) {
    return { error: invalidError };
  }
  const found = await proposalById(deps, input.proposalId);
  if ("error" in found) {
    return { error: found.error };
  }
  const verifyError = requireUntrackedVerification(found.proposal, input.untrackedVerified);
  if (verifyError) {
    return { error: verifyError };
  }
  const status = await freshProposalStatus(deps, found);
  if ("error" in status) {
    return status;
  }
  const guardError = guard(status);
  if (guardError) {
    return { error: guardError };
  }
  const planned = plan(found, status, input);
  if ("error" in planned) {
    return { error: planned.error };
  }
  const transactionHash = await submitAndRecord(
    deps,
    found.resolved,
    planned.calls,
    planned.summary,
  );
  await refreshAfterAction(deps, found).catch(() => undefined);
  return { ok: true, transactionHash };
};

const confirmGuard = (status: MultisigProposalStatus): string | null => {
  if (status.state === "executed" || status.state === "not-found") {
    return `cannot confirm a proposal that is ${status.state}`;
  }
  if (status.state === "confirmed") {
    return "proposal already has quorum — execute it instead of adding more confirmations";
  }
  return status.confirmedBySigner ? "this account has already confirmed this proposal" : null;
};

const revokeGuard = (status: MultisigProposalStatus): string | null => {
  if (status.state === "executed" || status.state === "not-found") {
    return `cannot revoke a proposal that is ${status.state}`;
  }
  return status.confirmedBySigner ? null : "this account has not confirmed this proposal";
};

// Plans a confirmation. With `andExecute` the signer asked to broadcast the
// proposal in the same transaction, which is only offered when this very
// confirmation reaches quorum — the `confirm_transaction` storage write lands
// before the batched `execute_transaction` re-reads it, so the component sees a
// confirmed proposal. Both calls share one transaction, so a failing inner call
// reverts the confirmation too; that is why this is opt-in rather than implicit.
const planConfirm = (
  found: ResolvedProposal,
  status: MultisigProposalStatus,
  input: MultisigProposalActionInput,
): ProposalActionPlan | { readonly error: string } => {
  const { record } = found.resolved;
  const confirmCall = buildMultisigConfirmCall(record.address, found.proposal.txId);
  if (input.andExecute !== true) {
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

const confirmMultisigProposal: MultisigTxHandler = (deps, message) =>
  runProposalAction(
    deps,
    message,
    "wallet.confirmMultisigProposal",
    "invalid confirm request",
    confirmGuard,
    planConfirm,
  );

const revokeMultisigConfirmation: MultisigTxHandler = (deps, message) =>
  runProposalAction(
    deps,
    message,
    "wallet.revokeMultisigConfirmation",
    "invalid revoke request",
    revokeGuard,
    (found) => ({
      calls: [buildMultisigRevokeCall(found.resolved.record.address, found.proposal.txId)],
      summary: `Revoke confirmation: ${found.proposal.summary}`,
    }),
  );

const executeMultisigProposal: MultisigTxHandler = async (deps, message) => {
  const input = readMultisigProposalActionInput(message, "wallet.executeMultisigProposal");
  if (!input) {
    return { error: "invalid execute request" };
  }
  const found = await proposalById(deps, input.proposalId);
  if ("error" in found) {
    return { error: found.error };
  }
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
  const transactionHash = await submitAndRecord(
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
  );
  await refreshAfterAction(deps, found).catch(() => undefined);
  return { ok: true, transactionHash };
};

// One handler per transaction-submitting multisig message type; the router
// below is a single map lookup and unknown types fall through to null.
const TX_HANDLERS: Record<string, MultisigTxHandler> = {
  "wallet.confirmMultisigProposal": confirmMultisigProposal,
  "wallet.executeMultisigProposal": executeMultisigProposal,
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
