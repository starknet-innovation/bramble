/**
 * Pure validation of dapp watch-asset request params (SNIP wallet_watchAsset),
 * shared by the provider bridge before a request reaches the background.
 */
import {
  hasOnlyKnownKeys,
  isBaseUnitsAmount,
  isRecord,
  isSafeDecimals,
  type Json,
} from "@bramble/core/json";
import { isNonZeroStarkFieldElement } from "@bramble/wallet-model/networks";
import { isOptionalApiVersion } from "../provider/versions";

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
 * accepting only an ERC20 token with a non-zero hex address. The spec's
 * optional `api_version` sits beside `type`, never inside `options`; a
 * well-formed one is dropped and a malformed one rejects the request.
 */
export const readProviderWatchAsset = (params: Json | undefined): ProviderWatchAsset | null => {
  if (
    !isRecord(params) ||
    !hasOnlyKnownKeys(params, ["api_version", "options", "type"]) ||
    !isOptionalApiVersion(params["api_version"]) ||
    params["type"] !== "ERC20" ||
    !isRecord(params["options"])
  ) {
    return null;
  }
  // The wallet API's `Asset` may carry an `image` URL. It is accepted when it
  // is a string and then dropped: the wallet never fetches a site's image
  // (Sherlock 252).
  const { image, ...options } = params["options"];
  if ((image !== undefined && typeof image !== "string") || !isProviderWatchAsset(options)) {
    return null;
  }
  return {
    address: options["address"],
    ...(options["decimals"] === undefined ? {} : { decimals: options["decimals"] }),
    ...(options["name"] === undefined ? {} : { name: options["name"] }),
    ...(options["symbol"] === undefined ? {} : { symbol: options["symbol"] }),
  };
};

/**
 * Dapp-provided collectible watch options after bridge validation: the
 * contract, a decimal token id, and the standard the site claims.
 */
export type ProviderWatchNft = {
  readonly address: string;
  readonly standard: "ERC721" | "ERC1155";
  readonly tokenId: string;
};

// A u256 token id, as the decimal string the wallet stores it in.
const MAX_TOKEN_ID = 2n ** 256n - 1n;
const tokenIdDecimal = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length === 0 || value.length > 80) return null;
  const decimal = isBaseUnitsAmount(value);
  if (!decimal && !/^0x[0-9a-fA-F]{1,64}$/u.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= MAX_TOKEN_ID ? parsed.toString() : null;
};

/**
 * Re-validates the internal collectible watch options after they cross the
 * runtime message boundary.
 */
export const isProviderWatchNft = (value: unknown): value is ProviderWatchNft =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["address", "standard", "tokenId"]) &&
  typeof value["address"] === "string" &&
  isNonZeroStarkFieldElement(value["address"]) &&
  (value["standard"] === "ERC721" || value["standard"] === "ERC1155") &&
  tokenIdDecimal(value["tokenId"]) === value["tokenId"];

/**
 * Parses an EIP-747-shaped `{ type: "ERC721" | "ERC1155", options: { address,
 * tokenId } }` payload. This is ahead of the Starknet wallet API, whose asset
 * type is ERC20 only. A string `image` or `name` is accepted and dropped: the
 * wallet reads collectible metadata itself, never the site's (Sherlock 252).
 */
export const readProviderWatchNft = (params: Json | undefined): ProviderWatchNft | null => {
  if (
    !isRecord(params) ||
    !hasOnlyKnownKeys(params, ["api_version", "options", "type"]) ||
    !isOptionalApiVersion(params["api_version"]) ||
    (params["type"] !== "ERC721" && params["type"] !== "ERC1155") ||
    !isRecord(params["options"])
  ) {
    return null;
  }
  const options = params["options"];
  if (
    !hasOnlyKnownKeys(options, ["address", "image", "name", "tokenId"]) ||
    (options["image"] !== undefined && typeof options["image"] !== "string") ||
    (options["name"] !== undefined && typeof options["name"] !== "string") ||
    typeof options["address"] !== "string" ||
    !isNonZeroStarkFieldElement(options["address"])
  ) {
    return null;
  }
  const tokenId = tokenIdDecimal(options["tokenId"]);
  return tokenId === null
    ? null
    : { address: options["address"], standard: params["type"], tokenId };
};
