/**
 * Custom Starknet chain model added by dapps through `wallet_addStarknetChain`,
 * kept out of preferences-store.ts so that file stays within the size budget.
 * Follows the built-in network model in starknet/networks.ts.
 */
import { hasOnlyKnownKeys, hasUniqueStrings, isRecord } from "../shared/json";
import { isCanonicalChainId } from "../starknet/networks";

const isLoopbackHost = (host: string): boolean => host === "localhost" || host === "127.0.0.1";

/**
 * Checks a user-provided RPC endpoint: https anywhere, http only on loopback.
 */
export const isCustomRpcUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname));
  } catch {
    return false;
  }
};

/**
 * A custom Starknet chain a dapp added. `chainId` is the CHAIN_ID felt used to
 * detect whether a chain is already listed; the URL lists are optional.
 */
export type CustomNetwork = {
  readonly blockExplorerUrls?: readonly string[];
  readonly chainId: string;
  readonly iconUrls?: readonly string[];
  readonly id: string;
  readonly name: string;
  readonly rpcUrls?: readonly string[];
};

/**
 * Normalizes a chain id to a decimal key so equal felts written differently
 * (`0x1` vs `0x01`) collapse to one entry.
 */
export const normalizeChainId = (chainId: string): string => BigInt(chainId).toString();

const isNetworkText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;

const isOptionalCustomUrlList = (value: unknown): value is readonly string[] | undefined =>
  value === undefined ||
  (Array.isArray(value) &&
    value.length > 0 &&
    value.every(isCustomRpcUrl) &&
    hasUniqueStrings(value));

/**
 * Checks an untrusted value is a well-formed stored custom network.
 */
export const isCustomNetwork = (value: unknown): value is CustomNetwork =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["blockExplorerUrls", "chainId", "iconUrls", "id", "name", "rpcUrls"]) &&
  isCanonicalChainId(value["chainId"]) &&
  isNetworkText(value["id"], 256) &&
  isNetworkText(value["name"], 256) &&
  isOptionalCustomUrlList(value["rpcUrls"]) &&
  isOptionalCustomUrlList(value["blockExplorerUrls"]) &&
  isOptionalCustomUrlList(value["iconUrls"]);
