/**
 * dApp-facing `wallet_addStarknetChain` handling. A connected or new origin may
 * ask the wallet to add a custom Starknet chain, but the wallet never persists
 * it without an explicit user approval: the request is validated, deduped
 * against already-listed chains, then queued as an "add-chain" approval whose
 * response is held until the user decides. Already-listed chains return true
 * with no prompt, per spec.
 */
import { isProviderChain, type ProviderChain } from "../provider/add-chain-params";
import { isBlockedOrigin } from "../security/blocklist";
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import { normalizeWalletOrigin } from "../shared/origin";
import { STARKNET_NETWORKS } from "../starknet/networks";
import { type CustomNetwork, normalizeChainId } from "../storage/custom-network";
import type { WalletPreferences, WalletPreferencesStore } from "../storage/preferences-store";
import { notifyApprovalsChanged } from "./approval-notifier";
import type { ApprovalQueue } from "./approvals";
import type { RuntimeResponse } from "./runtime-types";
import { isClaimedSenderOrigin, type RuntimeSender } from "./senders";
import type { SignatureWaiters } from "./signature-waiters";

/**
 * Dependencies for the dapp add-chain handler.
 */
export type AddChainOpsDeps = {
  readonly approvals: ApprovalQueue;
  readonly extensionId: string;
  readonly preferencesStore: WalletPreferencesStore;
  readonly waiters: SignatureWaiters;
};

/**
 * Parses a `wallet.addStarknetChain` runtime message crossed from the content
 * bridge, re-validating the chain descriptor and normalizing the origin.
 */
const readAddStarknetChainInput = (
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
 * Reduces a validated dapp chain to the stored custom-network shape.
 */
const toCustomNetwork = (chain: ProviderChain): CustomNetwork => ({
  chainId: chain.chainId,
  id: chain.id,
  name: chain.chainName,
  ...(chain.rpcUrls === undefined ? {} : { rpcUrls: chain.rpcUrls }),
  ...(chain.blockExplorerUrls === undefined ? {} : { blockExplorerUrls: chain.blockExplorerUrls }),
  ...(chain.iconUrls === undefined ? {} : { iconUrls: chain.iconUrls }),
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
  const { approvals, extensionId, preferencesStore, waiters } = deps;
  const input = readAddStarknetChainInput(message);
  if (!input) {
    return { error: "invalid add chain request" };
  }
  if (!isClaimedSenderOrigin(sender, extensionId, input.origin)) {
    return { error: "sender origin mismatch" };
  }
  if (isBlockedOrigin(input.origin)) {
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
