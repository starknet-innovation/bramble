/**
 * Bounds on the custom networks earlier builds stored for dapps through
 * `wallet_addStarknetChain` (Sherlock audit 153). Nothing adds or uses them
 * now (issue 852: the wallet refuses chains it cannot switch to), but a record
 * from an earlier build may still carry them in the single 1 MiB preferences
 * record, so it is compacted to a small, fixed footprint on read.
 */
import { isRecord } from "@bramble/core/json";

/**
 * Most stored custom networks kept when an earlier build's record is compacted.
 */
export const MAX_CUSTOM_NETWORKS = 16;

// Fields a stored network no longer keeps. Nothing reads them.
const DROPPED_FIELDS = new Set(["blockExplorerUrls", "iconUrls"]);

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
