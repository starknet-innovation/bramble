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
import {
  buildMultisigConfirmCall,
  buildMultisigExecuteCall,
  buildMultisigRevokeCall,
  buildMultisigSubmitCall,
  type MultisigCallInput,
  type MultisigProposalStatus,
} from "../starknet/multisig";
import {
  buildMultisigDeployCall,
  MULTISIG_CLASS_HASH,
  MULTISIG_COMPILED_CLASS_HASH,
  predictMultisigAddress,
  requireMultisigContractClass,
} from "../starknet/multisig-deploy";
import { STARKNET_NETWORKS } from "../starknet/networks";
import { type MultisigProposalRecord, multisigProposalId } from "../storage/multisig-store";
import { readTypeOnlyInput } from "./message-inputs";
import {
  readDeployMultisigInput,
  readMultisigProposalActionInput,
  readProposeMultisigInput,
} from "./multisig-inputs";
import {
  buildMultisigProposalRecord,
  defaultSummary,
  isProposalSubmitPending,
  type MultisigContext,
  type MultisigOpsDeps,
  multisigContext,
  multisigRpc,
  refreshSignerMembership,
} from "./multisig-ops";
import { activeAccountContext, networkRpcUrls } from "./runtime-state";
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

// Submits one call through the shared invoke path and records activity.
// The caller's descriptive summary is recorded verbatim: the generic call
// decoder cannot describe multisig entrypoints, and the dedup guards below
// match on these summaries, so they must stay deterministic and specific.
const submitAndRecord = async (
  deps: MultisigOpsDeps,
  resolved: MultisigContext,
  call: ReturnType<typeof buildMultisigConfirmCall>,
  summary: string,
): Promise<string> => {
  const result = await deps.runtimeRpc.submitInvokeTransaction({
    account: resolved.account.account,
    calls: [call],
    rpcUrls: resolved.rpcUrls,
    signHash: signerForContext(deps, resolved.account),
  });
  await deps.activity.record({
    accountId: resolved.account.account.id,
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
): Promise<void> => {
  if (status.state === "not-found" && (await isProposalSubmitPending(deps, proposal))) {
    return;
  }
  await deps.multisigStore.upsertProposal({
    ...proposal,
    confirmations: status.confirmations,
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
    await persistFreshStatus(deps, found.proposal, status);
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
  await persistFreshStatus(deps, found.proposal, status);
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
    buildMultisigSubmitCall(target.record.address, call, input.salt),
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
  await deps.multisigStore.upsertProposal(proposal);
  const stored = (await deps.multisigStore.listProposals()).find((p) => p.id === proposal.id);
  if (!stored) {
    return { error: "could not store proposal — the multisig may have been removed" };
  }
  // No post-broadcast status refresh here: the submit transaction cannot be
  // mined yet, so the chain would answer not-found for a proposal that was
  // just optimistically stored as pending.
  return { ok: true, proposal, transactionHash };
};

// Shared confirm/revoke flow: parse, resolve, enforce untracked-acknowledgement,
// refresh status, run the state-specific guard, then submit and record.
const runProposalAction = async (
  deps: MultisigOpsDeps,
  message: unknown,
  type: "wallet.confirmMultisigProposal" | "wallet.revokeMultisigConfirmation",
  invalidError: string,
  guard: (status: MultisigProposalStatus) => string | null,
  build: (address: string, txId: string) => ReturnType<typeof buildMultisigConfirmCall>,
  summaryPrefix: string,
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
  const transactionHash = await submitAndRecord(
    deps,
    found.resolved,
    build(found.resolved.record.address, found.proposal.txId),
    `${summaryPrefix}: ${found.proposal.summary}`,
  );
  await refreshAfterAction(deps, found);
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

const confirmMultisigProposal: MultisigTxHandler = (deps, message) =>
  runProposalAction(
    deps,
    message,
    "wallet.confirmMultisigProposal",
    "invalid confirm request",
    confirmGuard,
    buildMultisigConfirmCall,
    "Confirm",
  );

const revokeMultisigConfirmation: MultisigTxHandler = (deps, message) =>
  runProposalAction(
    deps,
    message,
    "wallet.revokeMultisigConfirmation",
    "invalid revoke request",
    revokeGuard,
    buildMultisigRevokeCall,
    "Revoke confirmation",
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
    buildMultisigExecuteCall(
      found.resolved.record.address,
      {
        calldata: proposalCall.calldata,
        contractAddress: proposalCall.contractAddress,
        entrypoint: proposalCall.entrypoint,
      },
      proposalCall.salt,
    ),
    `Execute: ${found.proposal.summary}`,
  );
  await refreshAfterAction(deps, found);
  return { ok: true, transactionHash };
};

const multisigClassStatus: MultisigTxHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.multisigClassStatus")) {
    return { error: "invalid class status request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const preferences = await deps.preferencesStore.read();
  const declared = await multisigRpc(deps).isClassDeclared({
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences),
  });
  return { declared, ok: true };
};

const declareMultisigClass: MultisigTxHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.declareMultisigClass")) {
    return { error: "invalid declare request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  if (!deps.loadMultisigClass) {
    return { error: "multisig class artifact unavailable" };
  }
  const preferences = await deps.preferencesStore.read();
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences);
  if (await multisigRpc(deps).isClassDeclared({ rpcUrls })) {
    return { error: "multisig class is already declared on this network" };
  }
  const activities = await deps.activity.list();
  const hasPendingDeclare = activities.some(
    (entry) =>
      entry.accountId === context.account.id &&
      entry.networkId === context.networkId &&
      entry.summary === "Declare multisig class" &&
      entry.status === "pending",
  );
  if (hasPendingDeclare) {
    return { error: "a declare transaction is already pending — wait for it to complete" };
  }
  const contractClass = requireMultisigContractClass(await deps.loadMultisigClass());
  const result = await deps.runtimeRpc.submitDeclareTransaction({
    account: context.account,
    classHash: MULTISIG_CLASS_HASH,
    compiledClassHash: MULTISIG_COMPILED_CLASS_HASH,
    contractClass,
    rpcUrls,
    signHash: signerForContext(deps, context),
  });
  await deps.activity.record({
    accountId: context.account.id,
    hash: result.transactionHash,
    kind: "invoke",
    networkId: context.networkId,
    summary: "Declare multisig class",
  });
  return { ok: true, transactionHash: result.transactionHash };
};

const deployMultisig: MultisigTxHandler = async (deps, message) => {
  const input = readDeployMultisigInput(message);
  if (!input) {
    return { error: "invalid deploy multisig request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const preferences = await deps.preferencesStore.read();
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences);
  if (!(await multisigRpc(deps).isClassDeclared({ rpcUrls }))) {
    return { error: "multisig class not declared on this network — declare it first" };
  }
  const config = { quorum: input.quorum, salt: input.salt, signers: input.signers };
  const address = predictMultisigAddress(config);
  let occupied: boolean;
  try {
    occupied = await deps.runtimeRpc.getDeploymentStatus({ accountAddress: address, rpcUrls });
  } catch {
    return {
      error: "could not verify whether this multisig address is free — try again",
    };
  }
  if (occupied) {
    return { error: "a multisig with these signers and salt already exists — watch it instead" };
  }
  // The recorded summary embeds the full predicted address and this guard
  // matches on the same marker — the two must stay in lockstep or the dedup
  // silently dies (it once matched a suffix the summary never contained).
  const deployMarker = ` at ${address}`;
  const activities = await deps.activity.list();
  const hasPendingDeploy = activities.some(
    (entry) =>
      entry.accountId === context.account.id &&
      entry.networkId === context.networkId &&
      entry.summary.includes(deployMarker) &&
      entry.status === "pending",
  );
  if (hasPendingDeploy) {
    return {
      error:
        "a deploy transaction for this multisig configuration is already pending — wait for it to complete",
    };
  }
  const call = buildMultisigDeployCall(config);
  const result = await deps.runtimeRpc.submitInvokeTransaction({
    account: context.account,
    calls: [call],
    rpcUrls,
    signHash: signerForContext(deps, context),
  });
  await deps.activity.record({
    accountId: context.account.id,
    hash: result.transactionHash,
    kind: "invoke",
    networkId: context.networkId,
    summary: `Deploy multisig (${input.quorum} of ${input.signers.length})${deployMarker}`,
  });
  return { address, ok: true, transactionHash: result.transactionHash };
};

// One handler per transaction-submitting multisig message type; the router
// below is a single map lookup and unknown types fall through to null.
const TX_HANDLERS: Record<string, MultisigTxHandler> = {
  "wallet.confirmMultisigProposal": confirmMultisigProposal,
  "wallet.declareMultisigClass": declareMultisigClass,
  "wallet.deployMultisig": deployMultisig,
  "wallet.executeMultisigProposal": executeMultisigProposal,
  "wallet.multisigClassStatus": multisigClassStatus,
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
  return handler ? handler(deps, message) : null;
};
