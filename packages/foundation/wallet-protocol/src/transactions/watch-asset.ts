/**
 * Pure validation of dapp watch-asset request params (SNIP wallet_watchAsset),
 * shared by the provider bridge before a request reaches the background.
 */
import { hasOnlyKnownKeys, isRecord, isSafeDecimals, type Json } from "@mc-wallet/core/json";
import { isNonZeroStarkFieldElement } from "@mc-wallet/wallet-model/networks";

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
 * Re-validates the internal watch-asset options after they cross the runtime
 * message boundary. The address grammar is the wallet model's canonical Stark
 * field grammar, so the page bridge and background cannot drift apart.
 */
export const isProviderWatchAsset = (value: unknown): value is ProviderWatchAsset =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["address", "decimals", "name", "symbol"]) &&
  typeof value["address"] === "string" &&
  isNonZeroStarkFieldElement(value["address"]) &&
  (value["decimals"] === undefined || isSafeDecimals(value["decimals"])) &&
  (value["name"] === undefined || typeof value["name"] === "string") &&
  (value["symbol"] === undefined || typeof value["symbol"] === "string");

/**
 * Parses a `{ type: "ERC20", options: { address, ... } }` watch-asset payload,
 * accepting only an ERC20 token with a non-zero hex address.
 */
export const readProviderWatchAsset = (params: Json | undefined): ProviderWatchAsset | null => {
  if (
    !isRecord(params) ||
    !hasOnlyKnownKeys(params, ["options", "type"]) ||
    params["type"] !== "ERC20" ||
    !isProviderWatchAsset(params["options"])
  ) {
    return null;
  }
  const options = params["options"];
  return {
    address: options["address"],
    ...(options["decimals"] === undefined ? {} : { decimals: options["decimals"] }),
    ...(options["name"] === undefined ? {} : { name: options["name"] }),
    ...(options["symbol"] === undefined ? {} : { symbol: options["symbol"] }),
  };
};
