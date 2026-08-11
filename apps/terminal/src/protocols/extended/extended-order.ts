/**
 * Extended perpetuals primitives: the REST paths, the order-payload shape the
 * exchange expects at `POST /api/v1/user/order`, the SNIP-12 typed-data envelope
 * the order hash is derived from, and the pure parser that maps the public
 * markets response into the shared `PerpMarketInfo` shape. Kept separate from
 * extended.ts so the network-facing surface stays small; nothing here performs
 * I/O — these are pure serializers, validators, and (via starknet-js) SNIP-12
 * hash math.
 *
 * ⚠️ Extended is the x10/x10xchange StarkEx perp DEX. The authoritative order
 * hash the exchange verifies is a StarkEx limit-order hash that folds in
 * per-market context (vault id, synthetic/collateral asset ids, expiry) which is
 * NOT present in the shared `PerpOrderParams`. The SNIP-12 envelope below is the
 * wallet-side representation of the human-readable order and MUST be reconciled
 * against api.docs.extended.exchange + the x10 SDK before a produced sig is
 * trusted for a live order. The typed-data domain/field names are transcribed from the
 * recon and marked VERIFY.
 */
import { typedData as snip12, type TypedData } from "starknet";
import { WalletError } from "../support/errors";
import { isRecord } from "../support/json";
import { isStarkFieldElement } from "../support/networks";
import type { PerpMarketInfo, PerpOrderParams, PerpOrderSide } from "../types";

/**
 * Public markets endpoint (BASE-USD list, prices, funding, leverage caps).
 */
export const EXTENDED_MARKETS_PATH = "/api/v1/info/markets";

/**
 * Authenticated order-placement endpoint. Builders here only assemble the
 * payload; the actual POST is intentionally not performed (no orders are placed).
 */
export const EXTENDED_ORDER_PATH = "/api/v1/user/order";

/**
 * Order-book side as the exchange spells it (buy -> long, sell -> short).
 */
export type ExtendedOrderSide = "BUY" | "SELL";

/**
 * Order lifetime policy. Extended supports GTT (good-till-time, needs an
 * expiry), IOC, FOK and post-only. `PerpOrderParams` carries no expiry, so the
 * builder defaults to GTC and flags the gap.
 */
export type ExtendedTimeInForce = "FOK" | "GTC" | "GTT" | "IOC";

/**
 * The JSON body posted to `/api/v1/user/order`, matching the fields the x10
 * `Order.create()` builder emits.
 */
export type ExtendedOrderPayload = {
  readonly marketName: string;
  readonly orderType: "LIMIT" | "MARKET";
  readonly side: ExtendedOrderSide;
  readonly amountOfSynthetic: string;
  readonly price: string;
  readonly timeInForce: ExtendedTimeInForce;
  readonly reduceOnly: boolean;
  readonly postOnly: boolean;
};

/**
 * Default time-in-force applied when the shared params carry no expiry. ⚠ A live
 * GTT order needs an explicit `expiryTime`; wire one through before trading.
 */
export const DEFAULT_TIME_IN_FORCE: ExtendedTimeInForce = "GTC";

// Maps the shared lowercase side onto the exchange's uppercase enum.
const toExtendedSide = (side: PerpOrderSide): ExtendedOrderSide =>
  side === "buy" ? "BUY" : "SELL";

// Accepts a positive decimal string (integer or fractional), rejecting floats
// expressed as numbers, empty strings, and non-positive values so the payload
// never carries a malformed size or price.
const assertPositiveDecimal = (value: string, label: string): string => {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(trimmed) || Number.parseFloat(trimmed) <= 0) {
    throw new WalletError(`Invalid Extended order ${label}`);
  }
  return trimmed;
};

/**
 * Assembles the exchange order body from the shared params. `price` presence
 * makes this a LIMIT order; a market order would need a distinct params flag,
 * which the shared contract does not yet expose. `postOnly` is not in the shared
 * params and defaults to false.
 */
export const buildOrderPayload = (params: PerpOrderParams): ExtendedOrderPayload => ({
  amountOfSynthetic: assertPositiveDecimal(params.size, "size"),
  marketName: params.market,
  orderType: "LIMIT",
  postOnly: false,
  price: assertPositiveDecimal(params.price, "price"),
  reduceOnly: params.reduceOnly ?? false,
  side: toExtendedSide(params.side),
  timeInForce: DEFAULT_TIME_IN_FORCE,
});

/**
 * SNIP-12 domain for Extended order messages. ⚠ VERIFY name/version/chainId
 * against the exchange's published typed-data spec before a produced sig is trusted.
 */
export const EXTENDED_ORDER_DOMAIN = {
  chainId: "SN_MAIN",
  name: "Extended",
  revision: "1",
  version: "1",
} as const;

/**
 * SNIP-12 type set describing the order struct that is hashed and signed. Field
 * order is the encoded-type order, so it is fixed here. ⚠ VERIFY field set.
 */
export const EXTENDED_ORDER_TYPES = {
  Order: [
    { name: "marketName", type: "shortstring" },
    { name: "side", type: "shortstring" },
    { name: "amountOfSynthetic", type: "shortstring" },
    { name: "price", type: "shortstring" },
    { name: "timeInForce", type: "shortstring" },
    { name: "reduceOnly", type: "bool" },
    { name: "postOnly", type: "bool" },
  ],
  StarknetDomain: [
    { name: "name", type: "shortstring" },
    { name: "version", type: "shortstring" },
    { name: "chainId", type: "shortstring" },
    { name: "revision", type: "shortstring" },
  ],
};

/**
 * Builds the SNIP-12 typed-data envelope for an order payload. The returned
 * object is what `orderMessageHash` hashes against the signer's account address.
 */
export const buildOrderTypedData = (payload: ExtendedOrderPayload): TypedData => ({
  domain: { ...EXTENDED_ORDER_DOMAIN },
  message: {
    amountOfSynthetic: payload.amountOfSynthetic,
    marketName: payload.marketName,
    postOnly: payload.postOnly,
    price: payload.price,
    reduceOnly: payload.reduceOnly,
    side: payload.side,
    timeInForce: payload.timeInForce,
  },
  primaryType: "Order",
  types: EXTENDED_ORDER_TYPES,
});

/**
 * Computes the SNIP-12 message hash the account's Stark key signs for an order,
 * validating the result is a field element. `accountAddress` binds the hash to
 * the signer per SNIP-12.
 */
export const orderMessageHash = (data: TypedData, accountAddress: string): string => {
  if (!isStarkFieldElement(accountAddress)) {
    throw new WalletError("Invalid Extended signer address");
  }
  let hash: string;
  try {
    hash = snip12.getMessageHash(data, accountAddress);
  } catch {
    throw new WalletError("Extended order hash could not be computed");
  }
  if (!isStarkFieldElement(hash)) {
    throw new WalletError("Extended order produced an invalid hash");
  }
  return hash;
};

// Reads a field from the market record, falling back to a nested `marketStats`
// object, and coerces a number or numeric string into a decimal string.
const readNumericField = (record: Record<string, unknown>, key: string): string => {
  const stats = isRecord(record.marketStats) ? record.marketStats : record;
  const direct = record[key];
  const value = typeof direct === "number" || typeof direct === "string" ? direct : stats[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" && value.length > 0 ? value : "0";
};

// Normalizes the exchange status enum, defaulting unknown values to REDUCE_ONLY
// so an unrecognized market is never surfaced as freely tradable.
const toMarketStatus = (value: unknown): PerpMarketInfo["status"] => {
  if (value === "ACTIVE" || value === "DELISTED" || value === "REDUCE_ONLY") {
    return value;
  }
  return "REDUCE_ONLY";
};

// Derives the base asset from an explicit `assetName` or the `BASE-USD` name.
const toBaseAsset = (record: Record<string, unknown>, name: string): string => {
  if (typeof record.assetName === "string" && record.assetName.length > 0) {
    return record.assetName;
  }
  const [base] = name.split("-");
  return base ?? name;
};

// Maps a single raw market record into a PerpMarketInfo, or null when it lacks a
// usable name so callers can skip malformed entries.
const toPerpMarketInfo = (raw: unknown): PerpMarketInfo | null => {
  if (!isRecord(raw) || typeof raw.name !== "string" || raw.name.length === 0) {
    return null;
  }
  const maxLeverageRaw = raw.maxLeverage;
  const maxLeverage =
    typeof maxLeverageRaw === "number"
      ? Math.trunc(maxLeverageRaw)
      : Number.parseInt(typeof maxLeverageRaw === "string" ? maxLeverageRaw : "", 10);
  return {
    baseAsset: toBaseAsset(raw, raw.name),
    fundingRate: readNumericField(raw, "fundingRate"),
    lastPrice: readNumericField(raw, "lastPrice"),
    maxLeverage: Number.isFinite(maxLeverage) && maxLeverage > 0 ? maxLeverage : 1,
    name: raw.name,
    openInterest: readNumericField(raw, "openInterest"),
    status: toMarketStatus(raw.status),
  };
};

/**
 * Parses the `/api/v1/info/markets` response into PerpMarketInfo rows. Accepts
 * either a bare array or the `{ status, data: [...] }` envelope the exchange
 * wraps list responses in, and silently drops malformed rows.
 */
export const parseMarketsResponse = (payload: unknown): readonly PerpMarketInfo[] => {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : null;
  if (rows === null) {
    throw new WalletError("Invalid Extended markets response");
  }
  const markets: PerpMarketInfo[] = [];
  for (const row of rows) {
    const market = toPerpMarketInfo(row);
    if (market !== null) {
      markets.push(market);
    }
  }
  return markets;
};
