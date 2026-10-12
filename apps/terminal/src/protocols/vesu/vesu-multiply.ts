/**
 * Vesu V2 Multiply open/increase path using a live Ekubo route. The quote is
 * untrusted HTTP data: its shape, its totals and its route are checked before
 * it is serialized into the deployed Multiply ABI, and every split must be a
 * connected path from the specified token to the calculated one. The quoter
 * still chooses the pools and the input it reports, and that input sets the
 * position's swap cap, so the cap is only as honest as the quoter (Sherlock
 * 147). Returned calls always require terminal and wallet review; this module
 * never signs or broadcasts.
 */
import { CairoCustomEnum, type Call, CallData, cairo } from "starknet";
import { VESU_ADDRESSES } from "../constants";
import { CAIRO_U128_MAX, CAIRO_U256_MAX } from "../support/cairo-integers";
import { WalletError } from "../support/errors";
import { isRecord } from "../support/json";
import {
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  sameAddress,
} from "../support/networks";
import { buildErc20ApproveCall } from "../support/rpc-assets";

const MAINNET_CHAIN_DECIMAL = BigInt("0x534e5f4d41494e").toString();
const EKUBO_QUOTER = "https://prod-api-quoter.ekubo.org";

type RouteNode = {
  readonly poolKey: {
    readonly extension: string;
    readonly fee: bigint;
    readonly tickSpacing: bigint;
    readonly token0: string;
    readonly token1: string;
  };
  readonly skipAhead: bigint;
  readonly sqrtRatioLimit: bigint;
};

type QuoteSplit = {
  readonly amountCalculated: bigint;
  readonly amountSpecified: bigint;
  readonly route: readonly RouteNode[];
};

/** Validated exact-output Ekubo route used to wind or unwind Multiply. */
export type VesuMultiplyExactOutQuote = {
  readonly outputAmount: bigint;
  readonly maxInputAmount: bigint;
  readonly requiredInputAmount: bigint;
  readonly priceImpactPct: number;
  readonly splits: readonly QuoteSplit[];
  readonly weights: readonly bigint[];
};

const absoluteUint = (value: unknown): bigint | null => {
  if (typeof value !== "string" || !/^-?(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)) return null;
  const parsed = BigInt(value);
  const absolute = parsed < 0n ? -parsed : parsed;
  return absolute <= CAIRO_U128_MAX ? absolute : null;
};

const absoluteU256 = (value: unknown): bigint | null => {
  if (typeof value !== "string" || !/^-?(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)) return null;
  const parsed = BigInt(value);
  const absolute = parsed < 0n ? -parsed : parsed;
  return absolute <= CAIRO_U256_MAX ? absolute : null;
};

const felt = (value: unknown): string | null =>
  typeof value === "string" && isStarkFieldElement(value.toLowerCase())
    ? value.toLowerCase()
    : null;

/**
 * The two tokens of an exact-output route: `specified` is the token whose
 * exact amount is requested (the route starts there) and `calculated` the one
 * the quoter prices it in (the route ends there).
 */
export type VesuMultiplyRouteTokens = {
  readonly calculated: string;
  readonly specified: string;
};

// Ekubo's router walks a route from the token-amount token: each pool must
// hold the current token, and the walk moves to the pool's other token. A
// split that does not end at the calculated token swaps something else.
const connectsTokens = (route: readonly RouteNode[], tokens: VesuMultiplyRouteTokens): boolean => {
  let current = tokens.specified;
  for (const node of route) {
    if (sameAddress(current, node.poolKey.token0)) {
      current = node.poolKey.token1;
    } else if (sameAddress(current, node.poolKey.token1)) {
      current = node.poolKey.token0;
    } else {
      return false;
    }
  }
  return sameAddress(current, tokens.calculated);
};

/**
 * Parses an exact-output quote and derives normalized split weights. Refuses a
 * malformed body, totals that disagree with the splits or with `outputAmount`,
 * and any split whose route is not a connected path from `tokens.specified`
 * to `tokens.calculated` (Sherlock 147).
 */
export const parseVesuMultiplyExactOutQuote = (
  body: unknown,
  outputAmount: bigint,
  slippageBps: number,
  tokens: VesuMultiplyRouteTokens,
): VesuMultiplyExactOutQuote => {
  if (
    !Number.isInteger(slippageBps) ||
    slippageBps < 1 ||
    slippageBps > 2_000 ||
    !isRecord(body) ||
    !Array.isArray(body.splits)
  ) {
    throw new WalletError("Invalid Vesu unwind quote");
  }
  const requiredInputAmount = absoluteUint(body.total_calculated);
  if (requiredInputAmount === null || requiredInputAmount === 0n) {
    throw new WalletError("Ekubo returned no Multiply liquidity");
  }
  const splits: QuoteSplit[] = [];
  let specifiedTotal = 0n;
  let calculatedTotal = 0n;
  for (const value of body.splits) {
    if (!isRecord(value) || !Array.isArray(value.route)) {
      throw new WalletError("Invalid Ekubo unwind route");
    }
    const amountSpecified = absoluteUint(value.amount_specified);
    const amountCalculated = absoluteUint(value.amount_calculated);
    if (
      amountSpecified === null ||
      amountSpecified === 0n ||
      amountCalculated === null ||
      amountCalculated === 0n
    ) {
      throw new WalletError("Invalid Ekubo unwind split");
    }
    const route: RouteNode[] = [];
    for (const rawNode of value.route) {
      if (!isRecord(rawNode) || !isRecord(rawNode.pool_key)) {
        throw new WalletError("Invalid Ekubo unwind node");
      }
      const token0 = felt(rawNode.pool_key.token0);
      const token1 = felt(rawNode.pool_key.token1);
      const extension = felt(rawNode.pool_key.extension);
      const fee = absoluteUint(rawNode.pool_key.fee);
      const tickSpacing =
        typeof rawNode.pool_key.tick_spacing === "number"
          ? BigInt(rawNode.pool_key.tick_spacing)
          : absoluteUint(rawNode.pool_key.tick_spacing);
      const sqrtRatioLimit = absoluteU256(rawNode.sqrt_ratio_limit);
      const skipAhead =
        typeof rawNode.skip_ahead === "number"
          ? BigInt(rawNode.skip_ahead)
          : absoluteUint(rawNode.skip_ahead);
      if (
        token0 === null ||
        token1 === null ||
        extension === null ||
        fee === null ||
        tickSpacing === null ||
        sqrtRatioLimit === null ||
        skipAhead === null
      ) {
        throw new WalletError("Invalid Ekubo unwind route values");
      }
      route.push({
        poolKey: { extension, fee, tickSpacing, token0, token1 },
        skipAhead,
        sqrtRatioLimit,
      });
    }
    if (route.length === 0) throw new WalletError("Empty Ekubo unwind route");
    if (!connectsTokens(route, tokens)) {
      throw new WalletError("Ekubo route does not connect the Multiply assets");
    }
    specifiedTotal += amountSpecified;
    calculatedTotal += amountCalculated;
    splits.push({ amountCalculated, amountSpecified, route });
  }
  if (specifiedTotal !== outputAmount || calculatedTotal !== requiredInputAmount) {
    throw new WalletError("Ekubo Multiply route amount mismatch");
  }
  const denominator = 10n ** 18n;
  const weights = splits.map((split) =>
    (split.amountCalculated * denominator) / requiredInputAmount
  );
  const weightTotal = weights.reduce((total, value) => total + value, 0n);
  weights[weights.length - 1] = (weights.at(-1) ?? 0n) + denominator - weightTotal;
  return {
    outputAmount,
    maxInputAmount: (requiredInputAmount * BigInt(10_000 + slippageBps)) / 10_000n,
    priceImpactPct:
      typeof body.price_impact === "number" && Number.isFinite(body.price_impact)
        ? body.price_impact * 100
        : 0,
    requiredInputAmount,
    splits,
    weights,
  };
};

/**
 * Quotes the exact additional collateral output for opening/increasing a
 * Multiply position. Ekubo returns the debt input required and Vesu enforces
 * the slippage-increased maximum inside the same atomic call.
 */
export const quoteVesuMultiplyIncrease = async (
  collateralAsset: string,
  debtAsset: string,
  collateralOutputRaw: bigint,
  slippageBps = 100,
): Promise<VesuMultiplyExactOutQuote> => {
  if (
    !isNonZeroStarkFieldElement(collateralAsset) ||
    !isNonZeroStarkFieldElement(debtAsset) ||
    collateralOutputRaw <= 0n ||
    collateralOutputRaw > CAIRO_U128_MAX
  ) {
    throw new WalletError("Invalid Vesu wind request");
  }
  const response = await fetch(
    `${EKUBO_QUOTER}/${MAINNET_CHAIN_DECIMAL}/-${collateralOutputRaw}/${collateralAsset}/${debtAsset}`,
    { headers: { accept: "application/json" } },
  );
  if (!response.ok) throw new WalletError("Could not quote Vesu wind route");
  return parseVesuMultiplyExactOutQuote(await response.json(), collateralOutputRaw, slippageBps, {
    calculated: debtAsset,
    specified: collateralAsset,
  });
};

/** Quotes the collateral required to repay all debt and close a Multiply position. */
export const quoteVesuMultiplyClose = async (
  debtAsset: string,
  collateralAsset: string,
  debtAmountRaw: bigint,
  slippageBps = 100,
): Promise<VesuMultiplyExactOutQuote> => {
  if (
    !isNonZeroStarkFieldElement(debtAsset) ||
    !isNonZeroStarkFieldElement(collateralAsset) ||
    debtAmountRaw <= 0n ||
    debtAmountRaw > CAIRO_U128_MAX
  ) {
    throw new WalletError("Invalid Vesu unwind request");
  }
  const response = await fetch(
    `${EKUBO_QUOTER}/${MAINNET_CHAIN_DECIMAL}/-${debtAmountRaw}/${debtAsset}/${collateralAsset}`,
    { headers: { accept: "application/json" } },
  );
  if (!response.ok) throw new WalletError("Could not quote Vesu unwind route");
  return parseVesuMultiplyExactOutQuote(await response.json(), debtAmountRaw, slippageBps, {
    calculated: collateralAsset,
    specified: debtAsset,
  });
};

const delegationCall = (poolAddress: string, enabled: boolean): Call => ({
  calldata: CallData.compile([VESU_ADDRESSES.multiply, enabled]),
  contractAddress: poolAddress,
  entrypoint: "modify_delegation",
});

/** Builds approve/delegate/modify/revoke calls for a Vesu Multiply increase. */
export const buildVesuMultiplyIncreaseCalls = (
  poolAddress: string,
  collateralAsset: string,
  debtAsset: string,
  accountAddress: string,
  marginAmountRaw: bigint,
  quote: VesuMultiplyExactOutQuote,
): readonly Call[] => {
  for (const [label, value] of [
    ["pool", poolAddress],
    ["collateral", collateralAsset],
    ["debt", debtAsset],
    ["account", accountAddress],
  ] as const) {
    if (!isNonZeroStarkFieldElement(value)) throw new WalletError(`Invalid Multiply ${label}`);
  }
  if (
    marginAmountRaw <= 0n ||
    marginAmountRaw > CAIRO_U128_MAX ||
    quote.splits.length === 0
  ) {
    throw new WalletError("Invalid Multiply margin");
  }
  const denominator = 10n ** 18n;
  const leverSwap = quote.splits.map((split, index) => ({
    route: split.route.map((node) => ({
      pool_key: {
        token0: node.poolKey.token0,
        token1: node.poolKey.token1,
        fee: node.poolKey.fee,
        tick_spacing: node.poolKey.tickSpacing,
        extension: node.poolKey.extension,
      },
      sqrt_ratio_limit: cairo.uint256(node.sqrtRatioLimit),
      skip_ahead: node.skipAhead,
    })),
    token_amount: {
      token: collateralAsset,
      amount: {
        mag: (quote.outputAmount * (quote.weights[index] ?? 0n)) / denominator,
        sign: true,
      },
    },
  }));
  const action = new CairoCustomEnum({
    IncreaseLever: {
      pool: poolAddress,
      collateral_asset: collateralAsset,
      debt_asset: debtAsset,
      user: accountAddress,
      add_margin: marginAmountRaw,
      margin_swap: [],
      margin_swap_limit_amount: 0n,
      lever_swap: leverSwap,
      lever_swap_limit_amount: quote.maxInputAmount,
    },
    DecreaseLever: undefined,
  });
  return [
    buildErc20ApproveCall(collateralAsset, VESU_ADDRESSES.multiply, marginAmountRaw),
    delegationCall(poolAddress, true),
    {
      calldata: CallData.compile({ action }),
      contractAddress: VESU_ADDRESSES.multiply,
      entrypoint: "modify_lever",
    },
    delegationCall(poolAddress, false),
    buildErc20ApproveCall(collateralAsset, VESU_ADDRESSES.multiply, 0n),
  ];
};

/** Builds one atomic delegate/close/revoke multicall for a full Multiply unwind. */
export const buildVesuMultiplyCloseCalls = (
  poolAddress: string,
  collateralAsset: string,
  debtAsset: string,
  accountAddress: string,
  quote: VesuMultiplyExactOutQuote,
): readonly Call[] => {
  for (const [label, value] of [
    ["pool", poolAddress],
    ["collateral", collateralAsset],
    ["debt", debtAsset],
    ["account", accountAddress],
  ] as const) {
    if (!isNonZeroStarkFieldElement(value)) throw new WalletError(`Invalid unwind ${label}`);
  }
  if (quote.splits.length === 0 || quote.weights.length !== quote.splits.length) {
    throw new WalletError("Invalid unwind route");
  }
  const leverSwap = quote.splits.map((split) => ({
    route: split.route.map((node) => ({
      pool_key: {
        token0: node.poolKey.token0,
        token1: node.poolKey.token1,
        fee: node.poolKey.fee,
        tick_spacing: node.poolKey.tickSpacing,
        extension: node.poolKey.extension,
      },
      sqrt_ratio_limit: cairo.uint256(node.sqrtRatioLimit),
      skip_ahead: node.skipAhead,
    })),
    token_amount: {
      token: debtAsset,
      amount: { mag: 0n, sign: true },
    },
  }));
  const action = new CairoCustomEnum({
    IncreaseLever: undefined,
    DecreaseLever: {
      pool: poolAddress,
      collateral_asset: collateralAsset,
      debt_asset: debtAsset,
      user: accountAddress,
      sub_margin: 0n,
      recipient: accountAddress,
      lever_swap: leverSwap,
      lever_swap_limit_amount: quote.maxInputAmount,
      lever_swap_weights: quote.weights,
      withdraw_swap: [],
      withdraw_swap_limit_amount: 0n,
      withdraw_swap_weights: [],
      close_position: true,
    },
  });
  return [
    delegationCall(poolAddress, true),
    {
      calldata: CallData.compile({ action }),
      contractAddress: VESU_ADDRESSES.multiply,
      entrypoint: "modify_lever",
    },
    delegationCall(poolAddress, false),
  ];
};
