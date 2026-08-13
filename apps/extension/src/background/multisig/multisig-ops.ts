/**
 * Multisig registry operations dispatched from the background message
 * handler: listing watched multisigs, watching one after proving on-chain
 * that it exposes the MultisigComponent views and that the active account is
 * a signer, refreshing config and proposal states, and tracking a proposal
 * id shared out-of-band. Each message type maps to one small handler; the
 * exported router is a single dispatch-map lookup. Transaction-submitting
 * multisig operations live in multisig-tx-ops.ts.
 */

import { multisigCallMatchesId } from "@mc-wallet/multisig/chain";
import {
  type MultisigProposalRecord,
  type MultisigRecord,
  type MultisigStore,
  multisigId,
  multisigProposalId,
} from "@mc-wallet/multisig/repository";
import type { MultisigSyncWarning } from "@mc-wallet/multisig/sync";
import {
  canonicalFelt,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";
import type { WalletOpsDeps } from "../accounts/wallet-ops";
import { readTypeOnlyInput } from "../routing/message-inputs";
import {
  type ActiveAccountContext,
  activeAccountContext,
  networkRpcUrls,
  observedAccountContext,
} from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import {
  type ProposeMultisigInput,
  readAddMultisigInput,
  readMultisigIdInput,
  readTrackMultisigProposalInput,
} from "./multisig-inputs";
import { refreshMultisigProposals } from "./multisig-proposal-status";

const MAX_NEW_PROPOSALS_PER_REFRESH = 20;

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
 * Resolved multisig action context: the selected signing account plus the
 * watched record, guaranteed to be on the active network.
 */
export type MultisigContext = {
  readonly account: ActiveAccountContext & { readonly error?: never };
  readonly record: MultisigRecord;
  readonly rpcUrls: readonly string[];
};

/**
 * Re-reads signer membership from chain, persists the fresh snapshot, and
 * rejects when the selected account is no longer a signer. Used immediately
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
    return { error: "the selected account is not a signer of this multisig" };
  }
  return next;
};

/**
 * Resolves a watched multisig by id against an account context the caller has
 * already resolved, enforcing that both live on the active network. Omitting
 * `signerAccountId` preserves the active-account behavior for non-transaction
 * operations.
 *
 * The account context is an argument rather than something resolved here
 * because resolving it is what decides whether the unlock window is renewed:
 * a handler the side panel polls passes {@link observedAccountContext} and a
 * handler the user just triggered passes {@link activeAccountContext}. Taking
 * the resolved value keeps that choice visible at the call site instead of
 * hiding one renewal behind a shared helper (MCW-V09-105).
 */
export const multisigContext = async (
  deps: MultisigOpsDeps,
  input: {
    readonly active: ActiveAccountContext;
    readonly id: string;
    readonly signerAccountId?: string | undefined;
  },
): Promise<{ readonly error: string } | MultisigContext> => {
  const { active: context, id, signerAccountId } = input;
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
  const signerAccount =
    signerAccountId === undefined
      ? context.account
      : context.accounts.find(
          (stored) => stored.id === signerAccountId && stored.networkId === context.networkId,
        );
  if (!signerAccount) {
    return { error: "selected signer account is unavailable on this network" };
  }
  const preferences = await deps.preferencesStore.read();
  return {
    account: { ...context, account: signerAccount },
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

export { isProposalSubmitPending } from "./multisig-proposal-status";

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

// Event IDs stay call-less until contract views verify their proposal state.
const discoverProposals = async (
  deps: MultisigOpsDeps,
  record: MultisigRecord,
  rpcUrls: readonly string[],
): Promise<MultisigSyncWarning | null> => {
  const discover = multisigRpc(deps).discoverProposalIds;
  if (!discover) {
    return null;
  }
  const result = await discover({ address: record.address, rpcUrls });
  const existing = new Set(
    (await deps.multisigStore.listProposals())
      .filter((proposal) => proposal.multisigId === record.id)
      .map((proposal) => proposal.txId),
  );
  const missing = result.ids
    .filter((txId) => !existing.has(txId))
    .slice(0, MAX_NEW_PROPOSALS_PER_REFRESH);
  for (const txId of missing) {
    const id = multisigProposalId(record.id, txId);
    if (id) {
      await deps.multisigStore.upsertProposal({
        call: null,
        confirmations: 0,
        id,
        multisigId: record.id,
        state: "pending",
        summary: "Discovered on-chain proposal",
        txId,
      });
    }
  }
  return result.complete &&
    missing.length === result.ids.filter((txId) => !existing.has(txId)).length
    ? null
    : "proposal-discovery-recent";
};

type MultisigOpsHandler = (deps: MultisigOpsDeps, message: unknown) => Promise<RuntimeResponse>;

const listMultisigs: MultisigOpsHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.multisigs")) {
    return { error: "invalid multisigs request" };
  }
  // Panel-poll traffic: observe the session, never extend it.
  const context = await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore);
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
  // Panel-poll traffic (side-panel hydration re-reads these balances on its
  // ambient cadence): observe the session, never extend it.
  const resolved = await multisigContext(deps, {
    active: await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore),
    id: input.id,
  });
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
  // Also panel-poll traffic: every hydration of a multisig view re-reads the
  // on-chain config, with no user action behind it.
  const resolved = await multisigContext(deps, {
    active: await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore),
    id: input.id,
  });
  if ("error" in resolved) {
    return { error: resolved.error };
  }
  const config = await multisigRpc(deps)
    .getConfig({
      address: resolved.record.address,
      rpcUrls: resolved.rpcUrls,
    })
    .catch(() => null);
  if (config === null) {
    return { error: "multisig configuration unavailable" };
  }
  const record: MultisigRecord = {
    ...resolved.record,
    quorum: config.quorum,
    signers: config.signers,
  };
  await deps.multisigStore.upsertMultisig(record);
  const localSigners = resolved.account.accounts
    .filter(
      (account) =>
        account.networkId === record.networkId &&
        record.signers.some((signer) => sameFelt(signer, account.address)),
    )
    .map((account) => account.address);
  const warnings: MultisigSyncWarning[] = [];
  try {
    const discoveryWarning = await discoverProposals(deps, record, resolved.rpcUrls);
    if (discoveryWarning) {
      warnings.push(discoveryWarning);
    }
  } catch {
    warnings.push("proposal-discovery-unavailable");
  }
  const refreshed = await refreshMultisigProposals(
    deps,
    record,
    localSigners,
    resolved.account.account.address,
    resolved.rpcUrls,
  );
  if (!refreshed.complete) {
    warnings.push("proposal-refresh-incomplete");
  }
  return {
    multisig: record,
    ok: true,
    proposals: refreshed.proposals,
    ...(warnings.length === 0 ? {} : { warnings }),
  };
};

// Re-tracking is the documented way out of a record whose stored call hashes to
// some other id (a hostile RPC answer persisted by an earlier version). Carrying
// that call over would leave the record exactly as poisoned as it was, so a
// stored call that does not bind to the tracked id is dropped and the record
// continues as id-only — the shape the acknowledgment paths can act on.
const retainedProposalCall = (
  existing: MultisigProposalRecord | undefined,
  txId: string,
): MultisigProposalRecord["call"] =>
  existing?.call && multisigCallMatchesId(existing.call, existing.call.salt, txId)
    ? existing.call
    : null;

const trackMultisigProposal: MultisigOpsHandler = async (deps, message) => {
  const input = readTrackMultisigProposalInput(message);
  if (!input) {
    return { error: "invalid track proposal request" };
  }
  // User-initiated: the user pasted a proposal id and pressed track.
  const resolved = await multisigContext(deps, {
    active: await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore),
    id: input.multisigId,
  });
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
  if (input.call) {
    const computedId = await multisigRpc(deps).computeTransactionId({
      address: resolved.record.address,
      call: input.call,
      rpcUrls: resolved.rpcUrls,
      salt: input.call.salt,
    });
    if (!sameFelt(computedId, input.txId)) {
      return { error: "review package call does not match this on-chain proposal id" };
    }
  }
  const id = multisigProposalId(resolved.record.id, input.txId);
  if (!id) {
    return { error: "invalid track proposal request" };
  }
  const existing = (await deps.multisigStore.listProposals()).find((p) => p.id === id);
  const proposal: MultisigProposalRecord = {
    call: input.call ?? retainedProposalCall(existing, input.txId),
    confirmations: status.confirmations,
    confirmedBySigner: status.confirmedBySigner,
    confirmedBySignerAddress: resolved.account.account.address,
    confirmedSignerAddresses: status.confirmedBySigner ? [resolved.account.account.address] : [],
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

// One registry handler per message type; unknown types fall through to null.
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
  const handler = Object.hasOwn(OPS_HANDLERS, messageType) ? OPS_HANDLERS[messageType] : undefined;
  return handler ? handler(deps, message) : null;
};
