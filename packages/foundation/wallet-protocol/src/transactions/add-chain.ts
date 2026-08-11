/**
 * Pure validation of dapp `wallet_addStarknetChain` params (STARKNET_CHAIN),
 * shared by the provider bridge and the background handler so a malformed chain
 * descriptor is rejected identically on both sides of the wire.
 */
import { hasOnlyKnownKeys, isRecord, type Json } from "@mc-wallet/core/json";
import { isCanonicalChainId } from "@mc-wallet/wallet-model/networks";

/**
 * A custom Starknet chain a dapp asks the wallet to add, after bridge
 * validation. `chainId` is a CHAIN_ID felt; the URL lists are optional.
 */
export type ProviderChain = {
  readonly blockExplorerUrls?: readonly string[];
  readonly chainId: string;
  readonly chainName: string;
  readonly iconUrls?: readonly string[];
  readonly id: string;
  readonly rpcUrls?: readonly string[];
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 256;

const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

// Validates an optional URI array: every entry an http(s) URL, at least one
// entry, all unique. Returns null when the value is malformed.
const readUrlList = (value: unknown): readonly string[] | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0 || !value.every(isHttpUrl)) {
    return null;
  }
  return new Set(value).size === value.length ? [...value] : null;
};

/**
 * Parses a `{ id, chain_id, chain_name, rpc_urls?, ... }` STARKNET_CHAIN object,
 * accepting only the spec-required fields plus optional URI lists. Returns the
 * internal camelCase chain, or null for any malformed descriptor.
 */
export const readProviderChain = (params: Json | undefined): ProviderChain | null => {
  if (
    !isRecord(params) ||
    !hasOnlyKnownKeys(params, [
      "block_explorer_url",
      "chain_id",
      "chain_name",
      "icon_urls",
      "id",
      "native_currency",
      "rpc_urls",
    ]) ||
    !isNonEmptyString(params["id"]) ||
    !isCanonicalChainId(params["chain_id"]) ||
    !isNonEmptyString(params["chain_name"]) ||
    (params["native_currency"] !== undefined && !isRecord(params["native_currency"]))
  ) {
    return null;
  }
  const rpcUrls = readUrlList(params["rpc_urls"]);
  const blockExplorerUrls = readUrlList(params["block_explorer_url"]);
  const iconUrls = readUrlList(params["icon_urls"]);
  if (rpcUrls === null || blockExplorerUrls === null || iconUrls === null) {
    return null;
  }
  return {
    chainId: params["chain_id"],
    chainName: params["chain_name"].trim(),
    id: params["id"].trim(),
    ...(rpcUrls === undefined ? {} : { rpcUrls }),
    ...(blockExplorerUrls === undefined ? {} : { blockExplorerUrls }),
    ...(iconUrls === undefined ? {} : { iconUrls }),
  };
};

const isOptionalUrlArray = (value: unknown): value is readonly string[] | undefined =>
  value === undefined ||
  (Array.isArray(value) &&
    value.length > 0 &&
    value.every(isHttpUrl) &&
    new Set(value).size === value.length);

/**
 * Narrows an untrusted value to the internal camelCase `ProviderChain` shape,
 * used by the background handler to re-validate a chain crossed from the bridge.
 */
export const isProviderChain = (value: unknown): value is ProviderChain =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "blockExplorerUrls",
    "chainId",
    "chainName",
    "iconUrls",
    "id",
    "rpcUrls",
  ]) &&
  isCanonicalChainId(value["chainId"]) &&
  isNonEmptyString(value["chainName"]) &&
  isNonEmptyString(value["id"]) &&
  isOptionalUrlArray(value["rpcUrls"]) &&
  isOptionalUrlArray(value["blockExplorerUrls"]) &&
  isOptionalUrlArray(value["iconUrls"]);
