/**
 * Custom Starknet chain model added by dapps through `wallet_addStarknetChain`,
 * kept out of preferences-store.ts so that file stays within the size budget.
 * Follows the built-in network model in starknet/networks.ts.
 */
import { hasOnlyKnownKeys, isNetworkLabel, isRecord } from "../shared/json";
import { isOptionalServiceUrlList, isServiceUrl } from "../shared/service-url";
import { isCanonicalChainId } from "../starknet/networks";

/**
 * Checks a user-provided RPC endpoint: https anywhere, http only on loopback.
 */
export const isCustomRpcUrl = isServiceUrl;

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

/**
 * Checks an untrusted value is a well-formed stored custom network.
 */
export const isCustomNetwork = (value: unknown): value is CustomNetwork =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["blockExplorerUrls", "chainId", "iconUrls", "id", "name", "rpcUrls"]) &&
  isCanonicalChainId(value["chainId"]) &&
  isNetworkLabel(value["id"]) &&
  isNetworkLabel(value["name"]) &&
  isOptionalServiceUrlList(value["rpcUrls"]) &&
  isOptionalServiceUrlList(value["blockExplorerUrls"]) &&
  isOptionalServiceUrlList(value["iconUrls"]);
