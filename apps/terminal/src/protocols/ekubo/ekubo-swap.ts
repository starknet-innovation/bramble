/**
 * Ekubo swap primitives: the concrete pool-key / route shapes the opaque
 * `SwapQuote.route` carries, the standard fee-tier table, slippage math, and the
 * pure starknet-js calldata builders for the RouterV3 quote/swap/clear
 * entrypoints. Kept separate from ekubo.ts so the public protocol surface stays
 * within the module size budget. Nothing here touches the network — the on-chain
 * reads live in ekubo.ts; these are pure serializers and integer math.
 *
 * ⚠️ Contract shapes (entrypoint names, struct field order, fee/tick-spacing
 * constants, sqrt-ratio bounds) are transcribed from the Ekubo recon and must be
 * re-verified against docs.ekubo.org / the deployed RouterV3 ABI before any
 * mainnet swap is signed. starknet-js compiles plain objects depth-first in
 * property order, so the field order below IS the Cairo ABI order.
 */
import { type Call, CallData, cairo } from "starknet";
import { WalletError } from "../support/errors";
import { isRecord } from "../support/json";
import { isNonZeroStarkFieldElement, isStarkFieldElement } from "../support/networks";
import { EKUBO_ADDRESSES } from "../constants";

/**
 * Basis-points denominator (100% = 10_000 bps).
 */
const BPS_DENOMINATOR = 10_000n;

/**
 * Default swap slippage tolerance (0.5%) applied when a caller omits one.
 * ⚠️ Product default — confirm against the terminal's chosen tolerance.
 */
export const DEFAULT_SLIPPAGE_BPS = 50;

/**
 * `skip_ahead` gas hint for the router; 0 disables the optimization.
 */
export const EKUBO_SKIP_AHEAD = "0";

/**
 * Ekubo sqrt-ratio bounds (0.128 fixed-point, u256). Used as the unbounded limit
 * when reading a quote and as clamps for the slippage-derived swap limit.
 * ⚠️ VERIFY against the deployed core contract constants.
 */
const MIN_SQRT_RATIO = 18446748437148339061n;
/**
 * Upper Ekubo sqrt-ratio bound (see MIN_SQRT_RATIO).
 */
const MAX_SQRT_RATIO = 6277100250585753475930931601400621808602321654880405518632n;

/**
 * A single Ekubo pool key. token0 < token1 numerically; `fee` and `tickSpacing`
 * are u128 decimal strings; `extension` is the pool's extension contract (0x0
 * for a vanilla pool).
 */
export type EkuboPoolKey = {
  readonly token0: string;
  readonly token1: string;
  readonly fee: string;
  readonly tickSpacing: string;
  readonly extension: string;
};

/**
 * The Ekubo-specific payload stashed in `SwapQuote.route`. Captures everything
 * buildSwapCalls needs to reproduce the quoted single-hop trade without a second
 * network round trip: the resolved pool key, the raw sell/buy magnitudes, the
 * pool's current sqrt ratio at quote time (for the slippage-derived limit), and
 * the swap direction.
 */
export type EkuboRoute = {
  readonly protocol: "ekubo";
  readonly poolKey: EkuboPoolKey;
  readonly sellToken: string;
  readonly buyToken: string;
  readonly sellAmount: string;
  readonly buyAmount: string;
  readonly currentSqrtRatio: string;
  readonly sellIsToken0: boolean;
  readonly skipAhead: string;
};

/**
 * A standard Ekubo fee tier: the u128 fee (fraction × 2^128) and its paired tick
 * spacing. Quoting tries each tier and keeps the best-priced pool.
 * ⚠️ VERIFY these exact integers — a wrong fee/tick-spacing pair addresses a
 * non-existent pool and the quote reverts or returns zero.
 */
export type EkuboFeeTier = {
  readonly label: string;
  readonly fee: bigint;
  readonly tickSpacing: bigint;
};

/**
 * Canonical Ekubo fee tiers, cheapest first.
 */
export const EKUBO_FEE_TIERS: readonly EkuboFeeTier[] = [
  { fee: 34028236692093846346337460743176821n, label: "0.01%", tickSpacing: 200n },
  { fee: 170141183460469231731687303715884106n, label: "0.05%", tickSpacing: 1000n },
  { fee: 1020847100762815390390123822295304634n, label: "0.30%", tickSpacing: 5982n },
  { fee: 3402823669209384634633746074317682115n, label: "1.00%", tickSpacing: 19802n },
];

/**
 * Orders a token pair into Ekubo's (token0 < token1) convention and reports
 * whether the sell token is token0 (which fixes the price-movement direction).
 */
export const orderTokens = (
  sellToken: string,
  buyToken: string,
): { readonly token0: string; readonly token1: string; readonly sellIsToken0: boolean } => {
  const sellIsToken0 = BigInt(sellToken) < BigInt(buyToken);
  return sellIsToken0
    ? { sellIsToken0, token0: sellToken, token1: buyToken }
    : { sellIsToken0, token0: buyToken, token1: sellToken };
};

/**
 * Builds a pool key object for a tier over an already-ordered token pair.
 */
export const buildPoolKey = (
  token0: string,
  token1: string,
  tier: EkuboFeeTier,
  extension = "0x0",
): EkuboPoolKey => ({
  extension,
  fee: tier.fee.toString(),
  tickSpacing: tier.tickSpacing.toString(),
  token0,
  token1,
});

// Serializes a pool key as the Cairo `PoolKey` struct (field order matters).
const poolKeyStruct = (poolKey: EkuboPoolKey): Record<string, unknown> => ({
  token0: poolKey.token0,
  token1: poolKey.token1,
  fee: poolKey.fee,
  tick_spacing: poolKey.tickSpacing,
  extension: poolKey.extension,
});

// Serializes a Cairo `i129 { mag: u128, sign: bool }` signed integer.
const i129 = (magnitude: bigint, negative: boolean): Record<string, unknown> => ({
  mag: magnitude.toString(),
  sign: negative ? 1n : 0n,
});

// Serializes a Cairo `RouteNode { pool_key, sqrt_ratio_limit: u256, skip_ahead }`.
const routeNode = (
  poolKey: EkuboPoolKey,
  sqrtRatioLimit: bigint,
  skipAhead: string,
): Record<string, unknown> => ({
  pool_key: poolKeyStruct(poolKey),
  sqrt_ratio_limit: cairo.uint256(sqrtRatioLimit),
  skip_ahead: skipAhead,
});

// Serializes a Cairo `TokenAmount { token, amount: i129 }` (positive = exact in).
const tokenAmount = (token: string, amountRaw: bigint): Record<string, unknown> => ({
  token,
  amount: i129(amountRaw, false),
});

/**
 * Compiles calldata for RouterV3 `quote_swap(route, token_amount)`. The limit is
 * an unbounded sqrt-ratio bound (MIN when selling token0, MAX otherwise) so the
 * read returns the full available output.
 */
export const buildQuoteCalldata = (
  poolKey: EkuboPoolKey,
  sellToken: string,
  sellAmountRaw: bigint,
  sellIsToken0: boolean,
): string[] =>
  CallData.compile({
    route: routeNode(poolKey, sellIsToken0 ? MIN_SQRT_RATIO : MAX_SQRT_RATIO, EKUBO_SKIP_AHEAD),
    token_amount: tokenAmount(sellToken, sellAmountRaw),
  });

/**
 * Compiles calldata for Core `get_pool_price(pool_key)`: the `PoolKey` struct
 * alone (five felts). Core rejects any longer input, so the RouterV3 quote
 * calldata must never be reused here (Sherlock 133).
 */
export const buildPoolPriceCalldata = (poolKey: EkuboPoolKey): string[] =>
  CallData.compile({ pool_key: poolKeyStruct(poolKey) });

/**
 * Parses a RouterV3 `quote_swap` / `swap` `Delta { amount0: i129, amount1: i129 }`
 * response into the buy-side output magnitude (the pool-negative leg).
 */
export const parseQuoteOutput = (response: readonly string[], sellIsToken0: boolean): bigint => {
  const felts = response.slice(0, 4);
  if (felts.length < 4 || felts.some((felt) => typeof felt !== "string")) {
    throw new WalletError("Invalid Ekubo quote response");
  }
  // Delta = [amount0.mag, amount0.sign, amount1.mag, amount1.sign]; the buy leg
  // is the token the caller did not sell.
  const buyMagnitude = sellIsToken0 ? felts[2] : felts[0];
  if (typeof buyMagnitude !== "string" || !isStarkFieldElement(buyMagnitude)) {
    throw new WalletError("Invalid Ekubo quote response");
  }
  return BigInt(buyMagnitude);
};

/**
 * Parses a Core `get_pool_price` response, returning the current sqrt ratio
 * (u256, first two felts as [low, high]).
 */
export const parsePoolSqrtRatio = (response: readonly string[]): bigint => {
  const low = response[0];
  const high = response[1];
  if (
    typeof low !== "string" ||
    typeof high !== "string" ||
    !isStarkFieldElement(low) ||
    !isStarkFieldElement(high)
  ) {
    throw new WalletError("Invalid Ekubo pool price response");
  }
  return BigInt(low) + (BigInt(high) << 128n);
};

/**
 * Applies a slippage floor to a positive amount: `amount × (1 - bps/10_000)`.
 */
export const applySlippageFloor = (amount: bigint, slippageBps: number): bigint =>
  (amount * (BPS_DENOMINATOR - BigInt(slippageBps))) / BPS_DENOMINATOR;

/**
 * Derives the slippage-bounded sqrt-ratio limit from the pool's current sqrt
 * ratio. Selling token0 pushes the price (and sqrt ratio) down, so the limit is
 * a floor; selling token1 pushes it up, so the limit is a ceiling. The bound is
 * intentionally loose — the real guarantee is the `clear_minimum` min-output
 * check — and is clamped to the pool's absolute sqrt-ratio range.
 * ⚠️ Assumption: scales the sqrt ratio linearly by the slippage fraction; the
 * exact sqrt(price) relationship should be confirmed against the Ekubo SDK.
 */
export const computeSqrtRatioLimit = (
  currentSqrtRatio: bigint,
  slippageBps: number,
  sellIsToken0: boolean,
): bigint => {
  const bps = BigInt(slippageBps);
  const limit = sellIsToken0
    ? (currentSqrtRatio * (BPS_DENOMINATOR - bps)) / BPS_DENOMINATOR
    : (currentSqrtRatio * (BPS_DENOMINATOR + bps)) / BPS_DENOMINATOR;
  if (limit < MIN_SQRT_RATIO) {
    return MIN_SQRT_RATIO;
  }
  return limit > MAX_SQRT_RATIO ? MAX_SQRT_RATIO : limit;
};

/**
 * Builds the ERC20 `transfer(router, amount)` call that funds the RouterV3 with
 * the input token before the swap.
 */
export const buildRouterTransferCall = (sellToken: string, amountRaw: bigint): Call => {
  if (!isNonZeroStarkFieldElement(sellToken)) {
    throw new WalletError("Invalid Ekubo sell token");
  }
  return {
    calldata: CallData.compile([EKUBO_ADDRESSES.routerV3, cairo.uint256(amountRaw)]),
    contractAddress: sellToken,
    entrypoint: "transfer",
  };
};

/**
 * Builds the RouterV3 `swap(route, token_amount)` call with the slippage-bounded
 * sqrt-ratio limit.
 */
export const buildRouterSwapCall = (
  poolKey: EkuboPoolKey,
  sellToken: string,
  sellAmountRaw: bigint,
  sqrtRatioLimit: bigint,
  skipAhead: string,
): Call => ({
  calldata: CallData.compile({
    route: routeNode(poolKey, sqrtRatioLimit, skipAhead),
    token_amount: tokenAmount(sellToken, sellAmountRaw),
  }),
  contractAddress: EKUBO_ADDRESSES.routerV3,
  entrypoint: "swap",
});

/**
 * Builds the RouterV3 `clear_minimum(token, minimum)` call: sweeps the swapped
 * output back to the caller only if at least `minimum` accrued, reverting on
 * excessive slippage.
 */
export const buildClearMinimumCall = (buyToken: string, minBuyAmount: bigint): Call => {
  if (!isNonZeroStarkFieldElement(buyToken)) {
    throw new WalletError("Invalid Ekubo buy token");
  }
  return {
    calldata: CallData.compile([buyToken, cairo.uint256(minBuyAmount)]),
    contractAddress: EKUBO_ADDRESSES.routerV3,
    entrypoint: "clear_minimum",
  };
};

/**
 * Builds the RouterV3 `clear(token)` call that returns any residual input token
 * dust to the caller after the swap.
 */
export const buildClearCall = (token: string): Call => ({
  calldata: CallData.compile([token]),
  contractAddress: EKUBO_ADDRESSES.routerV3,
  entrypoint: "clear",
});

/**
 * Narrows the opaque `SwapQuote.route` to an EkuboRoute, rejecting foreign or
 * malformed payloads before buildSwapCalls consumes them.
 */
export const isEkuboRoute = (value: unknown): value is EkuboRoute => {
  if (!isRecord(value) || value.protocol !== "ekubo" || !isRecord(value.poolKey)) {
    return false;
  }
  const stringFields = [
    value.sellToken,
    value.buyToken,
    value.sellAmount,
    value.buyAmount,
    value.currentSqrtRatio,
    value.skipAhead,
  ];
  return (
    stringFields.every((field) => typeof field === "string") &&
    typeof value.sellIsToken0 === "boolean"
  );
};
