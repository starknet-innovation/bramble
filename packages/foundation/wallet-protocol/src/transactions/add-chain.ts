/**
 * Pure validation of dapp `wallet_addStarknetChain` params (STARKNET_CHAIN),
 * shared by the provider bridge and the background handler so a malformed chain
 * descriptor is rejected identically on both sides of the wire.
 */

import {
  hasOnlyKnownKeys,
  isNetworkLabel,
  isPrintableName,
  isRecord,
  type Json,
} from "@bramble/core/json";
import { hasRedactionBreak, isBoundedServiceUrlList } from "@bramble/core/service-url";
import { isCanonicalChainId, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { isOptionalApiVersion } from "../provider/versions";

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

/**
 * Most entries a dapp may send in each `wallet_addStarknetChain` URL list.
 * Spec dapps send one or two RPCs. Without a bound one approved card could
 * fill the 1 MiB preferences record (Sherlock audit 153). The bridge and the
 * background both apply it, so an oversized request fails before any prompt.
 */
export const MAX_CHAIN_URLS = 4;

// Entered by a dapp, so every entry must also redact whole (`hasRedactionBreak`).
const isChainUrlList = (value: unknown): value is readonly string[] =>
  isBoundedServiceUrlList(value, MAX_CHAIN_URLS) && !value.some(hasRedactionBreak);

const isOptionalChainUrlList = (value: unknown): value is readonly string[] | undefined =>
  value === undefined || isChainUrlList(value);

// Validates an optional URI array against the shared endpoint-list rule
// (`isServiceUrlList`, the same predicate `isCustomNetwork` applies to the
// stored network) plus the entry bound, returning null when it is malformed.
const readUrlList = (value: unknown): readonly string[] | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return isChainUrlList(value) ? [...value] : null;
};

const foldNetworkName = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

const BUILT_IN_NETWORK_NAMES = new Set(
  Object.values(STARKNET_NETWORKS).map((network) => foldNetworkName(network.name)),
);

// A site names the network it asks the wallet to add, and the card and the
// stored record show that name. It must be printable ASCII, so control,
// bidi-override and homoglyph characters cannot dress it up, and it must not
// be a built-in network's name, or an attacker's RPC could be added as
// "Starknet Mainnet" (Sherlock 130). The stored-network rule stays the wider
// `isNetworkLabel`, so a record saved before this check still loads.
const isSiteNetworkName = (value: unknown): value is string =>
  isNetworkLabel(value) &&
  isPrintableName(value) &&
  !BUILT_IN_NETWORK_NAMES.has(foldNetworkName(value));

/**
 * Parses a `{ id, chain_id, chain_name, rpc_urls?, ... }` STARKNET_CHAIN object,
 * accepting only the spec-required fields plus optional URI lists. Returns the
 * internal camelCase chain, or null for any malformed descriptor. The spec's
 * optional `api_version` rides beside the chain fields and is dropped when
 * well-formed; it is never part of the stored chain.
 */
export const readProviderChain = (params: Json | undefined): ProviderChain | null => {
  if (
    !isRecord(params) ||
    !hasOnlyKnownKeys(params, [
      "api_version",
      "block_explorer_url",
      "chain_id",
      "chain_name",
      "icon_urls",
      "id",
      "native_currency",
      "rpc_urls",
    ]) ||
    !isOptionalApiVersion(params["api_version"]) ||
    !isSiteNetworkName(params["id"]) ||
    !isCanonicalChainId(params["chain_id"]) ||
    !isSiteNetworkName(params["chain_name"]) ||
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
  isSiteNetworkName(value["chainName"]) &&
  isSiteNetworkName(value["id"]) &&
  isOptionalChainUrlList(value["rpcUrls"]) &&
  isOptionalChainUrlList(value["blockExplorerUrls"]) &&
  isOptionalChainUrlList(value["iconUrls"]);
