/**
 * Pure validation of dapp watch-asset request params (SNIP wallet_watchAsset),
 * shared by the provider bridge before a request reaches the background.
 */
import { hasOnlyKnownKeys, isRecord, isSafeDecimals, type Json } from "@mc-wallet/core/json";

/**
 * Dapp-provided ERC20 watch-asset options after bridge validation.
 */
export type ProviderWatchAsset = {
  readonly address: string;
  readonly decimals?: number;
  readonly name?: string;
  readonly symbol?: string;
};

/**
 * Parses a `{ type: "ERC20", options: { address, ... } }` watch-asset payload,
 * accepting only an ERC20 token with a non-zero hex address.
 */
export const readProviderWatchAsset = (params: Json | undefined): ProviderWatchAsset | null => {
  if (
    !isRecord(params) ||
    !hasOnlyKnownKeys(params, ["options", "type"]) ||
    params["type"] !== "ERC20" ||
    !isRecord(params["options"]) ||
    !hasOnlyKnownKeys(params["options"], ["address", "decimals", "name", "symbol"])
  ) {
    return null;
  }
  const options = params["options"];
  if (
    typeof options["address"] !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(options["address"]) ||
    BigInt(options["address"]) <= 0n ||
    (options["decimals"] !== undefined && !isSafeDecimals(options["decimals"])) ||
    (options["name"] !== undefined && typeof options["name"] !== "string") ||
    (options["symbol"] !== undefined && typeof options["symbol"] !== "string")
  ) {
    return null;
  }
  return {
    address: options["address"],
    ...(options["decimals"] === undefined ? {} : { decimals: options["decimals"] }),
    ...(options["name"] === undefined ? {} : { name: options["name"] }),
    ...(options["symbol"] === undefined ? {} : { symbol: options["symbol"] }),
  };
};
