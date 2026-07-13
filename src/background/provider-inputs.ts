/**
 * Pure parsers for dapp provider runtime messages that reach the background
 * from the content bridge: permission queries and watch-asset requests.
 */
import { hasOnlyKnownKeys, isRecord, isSafeDecimals } from "../shared/json";
import { normalizeWalletOrigin } from "../shared/origin";
import type { WatchAssetRequest } from "./watch-asset";

const readWatchAssetOptions = (value: unknown): WatchAssetRequest | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["address", "decimals", "name", "symbol"]) ||
    typeof value["address"] !== "string" ||
    (value["decimals"] !== undefined && !isSafeDecimals(value["decimals"])) ||
    (value["name"] !== undefined && typeof value["name"] !== "string") ||
    (value["symbol"] !== undefined && typeof value["symbol"] !== "string")
  ) {
    return null;
  }
  return {
    address: value["address"],
    ...(value["decimals"] === undefined ? {} : { decimals: value["decimals"] }),
    ...(value["name"] === undefined ? {} : { name: value["name"] }),
    ...(value["symbol"] === undefined ? {} : { symbol: value["symbol"] }),
  };
};

/**
 * Parses dapp permission queries from content-script traffic.
 */
export const readGetPermissionsInput = (message: unknown): { readonly origin: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["origin", "type"]) ||
    message["type"] !== "wallet.getPermissions"
  ) {
    return null;
  }
  const origin = normalizeWalletOrigin(message["origin"]);
  return origin ? { origin } : null;
};

/**
 * Parses dapp watch-asset requests from content-script traffic.
 */
export const readWatchAssetInput = (
  message: unknown,
): { readonly asset: WatchAssetRequest; readonly origin: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["asset", "origin", "type"]) ||
    message["type"] !== "wallet.watchAsset"
  ) {
    return null;
  }
  const origin = normalizeWalletOrigin(message["origin"]);
  const asset = readWatchAssetOptions(message["asset"]);
  return origin && asset ? { asset, origin } : null;
};
