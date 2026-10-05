/**
 * dApp-facing `wallet_addStarknetChain` handling. A connected or new origin may
 * ask the wallet to add a custom Starknet chain, but the wallet never persists
 * it without an explicit user approval: the request is validated, deduped
 * against already-listed chains, then queued as an "add-chain" approval whose
 * response is held until the user decides. Already-listed chains return true
 * with no prompt, per spec.
 */

import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { normalizeWalletOrigin } from "@bramble/core/origin";
import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "@bramble/permissions/blocklist";
import type { WalletPreferences, WalletPreferencesStore } from "@bramble/settings/preferences";
import { type CustomNetwork, normalizeChainId } from "@bramble/wallet-model/custom-network";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { isProviderChain, type ProviderChain } from "@bramble/wallet-protocol/add-chain";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import type { ApprovalQueue } from "../approvals/approvals";
import type { SignatureWaiters } from "../approvals/signature-waiters";
import {
  type ExtensionIdentity,
  isClaimedSenderOrigin,
  type RuntimeSender,
} from "../routing/senders";
import type { RuntimeResponse } from "../runtime/runtime-types";

/**
 * Dependencies for the dapp add-chain handler.
 */
export type AddChainOpsDeps = {
  readonly approvals: ApprovalQueue;
  readonly extension: ExtensionIdentity;
  readonly guard?: OriginGuard;
  readonly preferencesStore: WalletPreferencesStore;
  readonly waiters: SignatureWaiters;
};

/**
 * Parses a `wallet.addStarknetChain` runtime message crossed from the content
 * bridge, re-validating the chain descriptor and normalizing the origin.
 */
export const readAddStarknetChainInput = (
  message: unknown,
): { readonly chain: ProviderChain; readonly origin: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["chain", "origin", "type"]) ||
    message["type"] !== "wallet.addStarknetChain" ||
    !isProviderChain(message["chain"])
  ) {
    return null;
  }
  const origin = normalizeWalletOrigin(message["origin"]);
  return origin ? { chain: message["chain"], origin } : null;
};

/**
 * Reduces a validated dapp chain to the stored custom-network shape. The labels
 * are trimmed here as well as in the bridge reader: this lane also accepts a
 * chain crossed straight from a runtime message, and the store should hold the
 * same canonical text either way.
 *
 * Only the chain id, labels, and the first RPC URL (the one the approval card
 * shows) are kept. Nothing reads the other lists, and storing them let a dapp
 * fill the preferences record (Sherlock audit 153).
 */
const toCustomNetwork = (chain: ProviderChain): CustomNetwork => ({
  chainId: chain.chainId,
  id: chain.id.trim(),
  name: chain.chainName.trim(),
  ...(chain.rpcUrls?.[0] === undefined ? {} : { rpcUrls: [chain.rpcUrls[0]] }),
});

/**
 * Checks whether a chain id already matches a built-in or stored custom network.
 */
const chainAlreadyListed = (chainId: string, preferences: WalletPreferences): boolean => {
  const key = normalizeChainId(chainId);
  const builtIn = Object.values(STARKNET_NETWORKS).some(
    (network) => normalizeChainId(network.chainId) === key,
  );
  const custom = (preferences.customNetworks ?? []).some(
    (network) => normalizeChainId(network.chainId) === key,
  );
  return builtIn || custom;
};

const addChainSummaries = (chain: ProviderChain): readonly string[] => {
  const host = chain.rpcUrls?.[0] ? new URL(chain.rpcUrls[0]).host : "no RPC provided";
  return [chain.chainName, chain.chainId, host];
};

/**
 * Handles a dapp add-chain message; returns null for other message types.
 */
export const handleAddChainOps = async (
  deps: AddChainOpsDeps,
  messageType: string,
  message: unknown,
  sender: RuntimeSender | undefined,
): Promise<RuntimeResponse | null> => {
  if (messageType !== "wallet.addStarknetChain") {
    return null;
  }
  const { approvals, extension, preferencesStore, waiters } = deps;
  const guard = deps.guard ?? DEFAULT_ORIGIN_GUARD;
  const input = readAddStarknetChainInput(message);
  if (!input) {
    return { error: "invalid add chain request" };
  }
  if (!isClaimedSenderOrigin(sender, extension, input.origin)) {
    return { error: "sender origin mismatch" };
  }
  if (guard.isBlocked(input.origin)) {
    return { error: "origin blocked" };
  }
  const preferences = await preferencesStore.read();
  // An already-listed chain is a no-op success with no prompt, per spec.
  if (chainAlreadyListed(input.chain.chainId, preferences)) {
    return { added: true, ok: true };
  }
  const approval = approvals.requestAddChain({
    chain: input.chain,
    origin: input.origin,
    summaries: addChainSummaries(input.chain),
  });
  notifyApprovalsChanged();
  return waiters.register(approval.id);
};

/**
 * Persists a user-approved custom chain and reports the add succeeded.
 */
export const executeAddChainApproval = async (
  deps: Pick<AddChainOpsDeps, "preferencesStore">,
  input: { readonly chain: ProviderChain },
): Promise<RuntimeResponse> => {
  await deps.preferencesStore.addCustomNetwork(toCustomNetwork(input.chain));
  return { added: true, ok: true };
};
