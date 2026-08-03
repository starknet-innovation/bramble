/**
 * Multisig registry operations dispatched from the background message
 * handler: listing watched multisigs, watching one after proving on-chain
 * that it exposes the MultisigComponent views and that the active account is
 * a signer, refreshing config and proposal states, and tracking a proposal
 * id shared out-of-band. Each message type maps to one small handler; the
 * exported router is a single dispatch-map lookup. Transaction-submitting
 * multisig operations live in multisig-tx-ops.ts.
 */
import {
  canonicalFelt,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
  sameFelt,
} from "../starknet/networks";
import { isUnresolvedActivityStatus } from "../storage/activity-store";
import {
  type MultisigProposalRecord,
  type MultisigRecord,
  type MultisigStore,
  multisigId,
  multisigProposalId,
} from "../storage/multisig-store";
import { readTypeOnlyInput } from "./message-inputs";
import {
  type ProposeMultisigInput,
  readAddMultisigInput,
  readMultisigIdInput,
  readTrackMultisigProposalInput,
} from "./multisig-inputs";
import { activeAccountContext, networkRpcUrls } from "./runtime-state";
import type { RuntimeResponse } from "./runtime-types";
import type { WalletOpsDeps } from "./wallet-ops";

/**
 * Dependencies for multisig operations: the shared wallet-ops bundle plus
 * the multisig registry and, for the declare flow, a loader for the bundled
 * Sierra artifact (absent in test wiring).
 */
export type MultisigOpsDeps = WalletOpsDeps & {
  readonly loadMultisigClass?: (() => Promise<unknown>) | undefined;
  readonly multisigStore: MultisigStore;
};

/**
 * Resolved multisig action context: the active account plus the watched
 * record, guaranteed to be on the active network.
 */
export type MultisigContext = {
  readonly account: Awaited<ReturnType<typeof activeAccountContext>> & { readonly error?: never };
  readonly record: MultisigRecord;
  readonly rpcUrls: readonly string[];
};

/**
 * Re-reads signer membership from chain, persists the fresh snapshot, and
 * rejects when the active account is no longer a signer. Used immediately
 * before any signer-gated submission so stale registry data cannot offer
 * doomed transactions.
 */
export const refreshSignerMembership = async (
  deps: MultisigOpsDeps,
  resolved: MultisigContext,
): Promise<{ readonly error: string } | MultisigContext> => {
  const config = await multisigRpc(deps).getConfig({
    address: resolved.record.address,
    rpcUrls: resolved.rpcUrls,
  });
  const record: MultisigRecord = {
    ...resolved.record,
    quorum: config.quorum,
    signers: config.signers,
  };
  await deps.multisigStore.upsertMultisig(record);
  const next: MultisigContext = { ...resolved, record };
  if (!record.signers.some((signer) => sameFelt(signer, next.account.account.address))) {
    return { error: "the active account is not a signer of this multisig" };
  }
  return next;
};

/**
 * Resolves the active account and a watched multisig by id, enforcing that
 * both live on the active network. Returns an error response otherwise.
 */
export const multisigContext = async (
  deps: MultisigOpsDeps,
  id: string,
): Promise<{ readonly error: string } | MultisigContext> => {
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const record = (await deps.multisigStore.listMultisigs()).find((stored) => stored.id === id);
  if (!record) {
    return { error: "multisig not found" };
  }
  if (record.networkId !== context.networkId) {
    return { error: "switch to the multisig's network first" };
  }
  const preferences = await deps.preferencesStore.read();
  return {
    account: context,
    record,
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences),
  };
};

/**
 * Requires the multisig RPC surface, which test stubs may omit.
 */
export const multisigRpc = (deps: MultisigOpsDeps) => {
  const rpc = deps.runtimeRpc.multisig;
  if (!rpc) {
    throw new Error("multisig operations unavailable");
  }
  return rpc;
};

/**
 * Checks whether this wallet's submit transaction for a proposal is still
 * pending. While that activity row is pending, a not-found proposal status can
 * simply mean the submit has not mined yet; after it is accepted/rejected, a
 * not-found status is authoritative and should be persisted.
 */
export const isProposalSubmitPending = async (
  deps: MultisigOpsDeps,
  proposal: MultisigProposalRecord,
): Promise<boolean> => {
  const hash = proposal.submitTransactionHash;
  if (!hash) {
    return false;
  }
  try {
    const entries = await deps.activity.list();
    return entries.some((entry) => entry.hash === hash && isUnresolvedActivityStatus(entry.status));
  } catch {
    return true;
  }
};

const shortAddress = (address: string): string => `${address.slice(0, 8)}…${address.slice(-4)}`;

/**
 * Default proposal summary used when the proposer supplies none. Kept beside
 * the record builder so both the tx handler and its tests share one source.
 */
export const defaultSummary = (input: ProposeMultisigInput): string =>
  input.summary ?? `${input.entrypoint} on ${shortAddress(input.to)}`;

/**
 * Assembles the optimistic pending proposal record stored right after a
 * submit transaction is broadcast. Pure: no I/O, no clock, no randomness.
 */
export const buildMultisigProposalRecord = (input: {
  readonly input: ProposeMultisigInput;
  readonly multisigId: string;
  readonly id: string;
  readonly txId: string;
  readonly summary: string;
  readonly submitTransactionHash: string;
}): MultisigProposalRecord => ({
  call: {
    calldata: input.input.calldata,
    contractAddress: input.input.to,
    entrypoint: input.input.entrypoint,
    salt: input.input.salt,
  },
  confirmations: 0,
  id: input.id,
  multisigId: input.multisigId,
  state: "pending",
  submitTransactionHash: input.submitTransactionHash,
  summary: input.summary,
  txId: input.txId,
});

const scopedList = async (
  store: MultisigStore,
  networkId: StarknetNetworkId,
): Promise<{
  readonly multisigs: readonly MultisigRecord[];
  readonly proposals: readonly MultisigProposalRecord[];
}> => {
  const multisigs = (await store.listMultisigs()).filter(
    (record) => record.networkId === networkId,
  );
  const ids = new Set(multisigs.map((record) => record.id));
  const proposals = (await store.listProposals()).filter((proposal) =>
    ids.has(proposal.multisigId),
  );
  return { multisigs, proposals };
};

// Re-reads one proposal's on-chain status and persists the fresh snapshot. For
// wallet-submitted proposals, a not-found status is suppressed only while the
// submit transaction is still pending.
const refreshProposal = async (
  deps: MultisigOpsDeps,
  record: MultisigRecord,
  proposal: MultisigProposalRecord,
  signer: string,
  rpcUrls: readonly string[],
): Promise<MultisigProposalRecord> => {
  const status = await multisigRpc(deps).getProposalStatus({
    address: record.address,
    rpcUrls,
    signer,
    txId: proposal.txId,
  });
  if (status.state === "not-found" && (await isProposalSubmitPending(deps, proposal))) {
    return proposal;
  }
  const next: MultisigProposalRecord = {
    ...proposal,
    confirmations: status.confirmations,
    confirmedBySigner: status.confirmedBySigner,
    confirmedBySignerAddress: signer,
    state: status.state,
  };
  await deps.multisigStore.upsertProposal(next);
  return next;
};

/**
 * Refreshes every tracked proposal for a multisig, tolerating per-proposal
 * read failures so one broken read never hides the rest.
 */
const refreshProposals = async (
  deps: MultisigOpsDeps,
  record: MultisigRecord,
  signer: string,
  rpcUrls: readonly string[],
): Promise<readonly MultisigProposalRecord[]> => {
  const proposals = (await deps.multisigStore.listProposals()).filter(
    (proposal) => proposal.multisigId === record.id,
  );
  return Promise.all(
    proposals.map((proposal) =>
      proposal.state === "executed"
        ? proposal
        : refreshProposal(deps, record, proposal, signer, rpcUrls).catch(() => proposal),
    ),
  );
};

type MultisigOpsHandler = (deps: MultisigOpsDeps, message: unknown) => Promise<RuntimeResponse>;

const listMultisigs: MultisigOpsHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.multisigs")) {
    return { error: "invalid multisigs request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { multisigs: [], ok: true, proposals: [] };
  }
  const scoped = await scopedList(deps.multisigStore, context.networkId);
  return { ...scoped, ok: true };
};

const addMultisig: MultisigOpsHandler = async (deps, message) => {
  const input = readAddMultisigInput(message);
  if (!input) {
    return { error: "invalid add multisig request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const preferences = await deps.preferencesStore.read();
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences);
  const config = await multisigRpc(deps).getConfig({ address: input.address, rpcUrls });
  if (!config.signers.some((signer) => sameFelt(signer, context.account.address))) {
    return { error: "the active account is not a signer of this multisig" };
  }
  const id = multisigId(context.networkId, input.address);
  if (!id) {
    return { error: "invalid add multisig request" };
  }
  const record: MultisigRecord = {
    address: canonicalFelt(input.address) ?? input.address,
    id,
    ...(input.name === undefined ? {} : { name: input.name }),
    networkId: context.networkId,
    quorum: config.quorum,
    signers: config.signers,
  };
  await deps.multisigStore.upsertMultisig(record);
  return { multisig: record, ok: true };
};

const removeMultisig: MultisigOpsHandler = async (deps, message) => {
  const input = readMultisigIdInput(message, "wallet.removeMultisig");
  if (!input) {
    return { error: "invalid remove multisig request" };
  }
  await deps.multisigStore.removeMultisig(input.id);
  return { ok: true };
};

const loadMultisigBalances: MultisigOpsHandler = async (deps, message) => {
  const input = readMultisigIdInput(message, "wallet.multisigBalances");
  if (!input) {
    return { error: "invalid multisig balances request" };
  }
  const resolved = await multisigContext(deps, input.id);
  if ("error" in resolved) {
    return { error: resolved.error };
  }
  const preferences = await deps.preferencesStore.read();
  const balances = await deps.runtimeRpc.getTokenBalances({
    accountAddress: resolved.record.address,
    rpcUrls: resolved.rpcUrls,
    tokens: preferences.tokens.filter((token) => token.networkId === resolved.record.networkId),
  });
  return {
    accountId: resolved.record.id,
    balances,
    networkId: resolved.record.networkId,
    ok: true,
  };
};

const refreshMultisig: MultisigOpsHandler = async (deps, message) => {
  const input = readMultisigIdInput(message, "wallet.refreshMultisig");
  if (!input) {
    return { error: "invalid refresh multisig request" };
  }
  const resolved = await multisigContext(deps, input.id);
  if ("error" in resolved) {
    return { error: resolved.error };
  }
  const config = await multisigRpc(deps).getConfig({
    address: resolved.record.address,
    rpcUrls: resolved.rpcUrls,
  });
  const record: MultisigRecord = {
    ...resolved.record,
    quorum: config.quorum,
    signers: config.signers,
  };
  await deps.multisigStore.upsertMultisig(record);
  const proposals = await refreshProposals(
    deps,
    record,
    resolved.account.account.address,
    resolved.rpcUrls,
  );
  return { multisig: record, ok: true, proposals };
};

const trackMultisigProposal: MultisigOpsHandler = async (deps, message) => {
  const input = readTrackMultisigProposalInput(message);
  if (!input) {
    return { error: "invalid track proposal request" };
  }
  const resolved = await multisigContext(deps, input.multisigId);
  if ("error" in resolved) {
    return { error: resolved.error };
  }
  const status = await multisigRpc(deps).getProposalStatus({
    address: resolved.record.address,
    rpcUrls: resolved.rpcUrls,
    signer: resolved.account.account.address,
    txId: input.txId,
  });
  if (status.state === "not-found") {
    return { error: "no proposal with that id exists on this multisig" };
  }
  const id = multisigProposalId(resolved.record.id, input.txId);
  if (!id) {
    return { error: "invalid track proposal request" };
  }
  const existing = (await deps.multisigStore.listProposals()).find((p) => p.id === id);
  const proposal: MultisigProposalRecord = {
    call: existing?.call ?? null,
    confirmations: status.confirmations,
    confirmedBySigner: status.confirmedBySigner,
    confirmedBySignerAddress: resolved.account.account.address,
    id,
    multisigId: resolved.record.id,
    state: status.state,
    ...(existing?.submitTransactionHash === undefined
      ? {}
      : { submitTransactionHash: existing.submitTransactionHash }),
    summary: input.summary ?? existing?.summary ?? "Shared proposal",
    txId: canonicalFelt(input.txId) ?? input.txId,
  };
  await deps.multisigStore.upsertProposal(proposal);
  return { ok: true, proposal };
};

// One handler per registry-level multisig message type; the router below is a
// single map lookup and unknown types fall through to null.
const OPS_HANDLERS: Record<string, MultisigOpsHandler> = {
  "wallet.addMultisig": addMultisig,
  "wallet.multisigBalances": loadMultisigBalances,
  "wallet.multisigs": listMultisigs,
  "wallet.refreshMultisig": refreshMultisig,
  "wallet.removeMultisig": removeMultisig,
  "wallet.trackMultisigProposal": trackMultisigProposal,
};

/**
 * Handles registry-level multisig messages; returns null for other types.
 */
export const handleMultisigOps = async (
  deps: MultisigOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const handler = OPS_HANDLERS[messageType];
  return handler ? handler(deps, message) : null;
};
