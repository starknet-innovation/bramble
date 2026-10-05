/**
 * Bounds on the custom networks dapps add through `wallet_addStarknetChain`
 * (Sherlock audit 153). They live in the single 1 MiB preferences record, and
 * the only reader is the add-chain dedupe check, so the store keeps a small,
 * fixed footprint per network instead of whatever lists a dapp sent.
 */
import { WalletError } from "@bramble/core/errors";
import { isRecord } from "@bramble/core/json";
import {
  type CustomNetwork,
  isCustomNetwork,
  normalizeChainId,
} from "@bramble/wallet-model/custom-network";
import type { WalletPreferences } from "./preferences-types";

/**
 * Most custom networks kept. Adding one more evicts the oldest, which is
 * harmless: the list only lets a repeat add-chain request skip its prompt.
 */
export const MAX_CUSTOM_NETWORKS = 16;

// Fields a stored network no longer keeps. Nothing reads them.
const DROPPED_FIELDS = new Set(["blockExplorerUrls", "iconUrls"]);

const compactNetwork = (network: CustomNetwork): CustomNetwork => ({
  chainId: network.chainId,
  id: network.id,
  name: network.name,
  ...(network.rpcUrls?.[0] === undefined ? {} : { rpcUrls: [network.rpcUrls[0]] }),
});

/**
 * Adds or replaces (by normalized chain id) one custom network, keeping only
 * its first RPC URL and the newest {@link MAX_CUSTOM_NETWORKS} entries. Throws
 * {@link WalletError} for a malformed network.
 */
export const withCustomNetwork = (
  preferences: WalletPreferences,
  network: CustomNetwork,
): WalletPreferences => {
  if (!isCustomNetwork(network)) {
    throw new WalletError("Invalid custom network");
  }
  const key = normalizeChainId(network.chainId);
  const existing = (preferences.customNetworks ?? []).filter(
    (stored) => normalizeChainId(stored.chainId) !== key,
  );
  return {
    ...preferences,
    customNetworks: [...existing, compactNetwork(network)].slice(-MAX_CUSTOM_NETWORKS),
  };
};

const compactStoredNetwork = (entry: unknown): unknown => {
  if (!isRecord(entry)) {
    return entry;
  }
  const rpcUrls = entry["rpcUrls"];
  const trimRpc = Array.isArray(rpcUrls) && rpcUrls.length > 1;
  if (!trimRpc && !Object.keys(entry).some((key) => DROPPED_FIELDS.has(key))) {
    return entry;
  }
  const kept = Object.fromEntries(
    Object.entries(entry).filter(([key]) => !DROPPED_FIELDS.has(key)),
  );
  return trimRpc ? { ...kept, rpcUrls: rpcUrls.slice(0, 1) } : kept;
};

/**
 * Shrinks a stored `customNetworks` value written by an earlier build: drops
 * explorer and icon lists, keeps the first RPC URL, and keeps the newest
 * {@link MAX_CUSTOM_NETWORKS} entries. A record a dapp filled under v0.10.4
 * then fits the budget again on its next write, so token, contact and group
 * writes stop failing. Returns the same reference when nothing changes, and a
 * non-array value untouched for the validator to judge.
 */
export const compactStoredCustomNetworks = (value: unknown): unknown => {
  if (!Array.isArray(value)) {
    return value;
  }
  const compacted = value.map(compactStoredNetwork);
  const changed =
    value.length > MAX_CUSTOM_NETWORKS || compacted.some((entry, index) => entry !== value[index]);
  return changed ? compacted.slice(-MAX_CUSTOM_NETWORKS) : value;
};
