/**
 * Multisig registry operations dispatched from the background message
 * handler: listing watched multisigs, watching one after proving on-chain
 * that it exposes the MultisigComponent views and that the active account is
 * a signer, refreshing config and proposal states, and tracking a proposal
 * id shared out-of-band. Transaction-submitting multisig operations live in
 * multisig-tx-ops.ts.
 */
import { STARKNET_NETWORKS, type StarknetNetworkId } from "../starknet/networks";
import {
  type MultisigProposalRecord,
  type MultisigRecord,
  type MultisigStore,
  multisigId,
  multisigProposalId,
} from "../storage/multisig-store";
import { readTypeOnlyInput } from "./message-inputs";
import {
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
 * Compares two field elements by numeric value.
 */
export const sameFelt = (left: string, right: string): boolean => {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return false;
  }
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

// Re-reads one proposal's on-chain status and persists the fresh snapshot.
// A known proposal reading as not-found means the chain has not seen its
// submit transaction yet, so the stored snapshot is kept rather than
// downgraded into a dead-end state with no actions.
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
  if (status.state === "not-found") {
    return proposal;
  }
  const next: MultisigProposalRecord = {
    ...proposal,
    confirmations: status.confirmations,
    state: status.state,
  };
  await deps.multisigStore.upsertProposal(next);
  return next;
};

/**
 * Refreshes every tracked proposal for a multisig, tolerating per-proposal
 * read failures so one broken read never hides the rest.
 */
export const refreshProposals = async (
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

/**
 * Handles registry-level multisig messages; returns null for other types.
 */
export const handleMultisigOps = async (
  deps: MultisigOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType === "wallet.multisigs") {
    if (!readTypeOnlyInput(message, "wallet.multisigs")) {
      return { error: "invalid multisigs request" };
    }
    const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
    if (context.error !== undefined) {
      return { multisigs: [], ok: true, proposals: [] };
    }
    const scoped = await scopedList(deps.multisigStore, context.networkId);
    return { ...scoped, ok: true };
  }

  if (messageType === "wallet.addMultisig") {
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
      address: `0x${BigInt(input.address).toString(16)}`,
      id,
      ...(input.name === undefined ? {} : { name: input.name }),
      networkId: context.networkId,
      quorum: config.quorum,
      signers: config.signers,
    };
    await deps.multisigStore.upsertMultisig(record);
    return { multisig: record, ok: true };
  }

  if (messageType === "wallet.removeMultisig") {
    const input = readMultisigIdInput(message, "wallet.removeMultisig");
    if (!input) {
      return { error: "invalid remove multisig request" };
    }
    await deps.multisigStore.removeMultisig(input.id);
    return { ok: true };
  }

  if (messageType === "wallet.refreshMultisig") {
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
  }

  if (messageType === "wallet.trackMultisigProposal") {
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
      id,
      multisigId: resolved.record.id,
      state: status.state,
      summary: input.summary ?? existing?.summary ?? "Shared proposal",
      txId: `0x${BigInt(input.txId).toString(16)}`,
    };
    await deps.multisigStore.upsertProposal(proposal);
    return { ok: true, proposal };
  }

  return null;
};
