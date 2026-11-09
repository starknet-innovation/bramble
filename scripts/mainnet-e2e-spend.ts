/**
 * Hot-wallet spend policy for the mainnet E2E job.
 *
 * Amounts are integer token units. The standard tier is the unattended cap:
 * a compromised runner or environment secret can take at most the maximum
 * below, and one run can spend at most the per-run cap. The STRK20 tier is
 * opt-in because the privacy-pool lifecycle fee is far larger; it is still
 * bounded. Nothing here reads the network or a key.
 */

import {
  DEFAULT_TRACKED_TOKENS,
  STRK_TOKEN_DECIMALS,
  USDC_TOKEN_ADDRESS,
} from "@bramble/wallet-model/networks";
import {
  formatTokenAmount,
  parseTokenAmount,
} from "../packages/platform/starknet/src/rpc/balances";

const nativeUsdc = DEFAULT_TRACKED_TOKENS.find(
  (token) => token.networkId === "SN_MAIN" && token.symbol === "USDC",
);
if (nativeUsdc === undefined || nativeUsdc.address !== USDC_TOKEN_ADDRESS) {
  throw new Error("Native USDC is missing from the tracked token set");
}

const USDC_DECIMALS = nativeUsdc.decimals;

/** Which ceiling set a run is judged against. */
export type SpendTier = "standard" | "strk20";

/**
 * One token's preflight window and per-run spend cap, in raw units. `minRaw`
 * is a preflight-only requirement; the post-run check uses `capRaw` and
 * `maxRaw`.
 */
export type TokenCeiling = {
  readonly capRaw: bigint;
  readonly decimals: number;
  readonly maxRaw: bigint;
  readonly minRaw: bigint;
  readonly symbol: string;
};

/** STRK and native USDC ceilings for one tier. */
export type SpendCeilings = {
  readonly strk: TokenCeiling;
  readonly usdc: TokenCeiling;
};

/** STRK and USDC balances in raw units. */
export type BalancePair = {
  readonly strk: bigint;
  readonly usdc: bigint;
};

/** Why a balance or a delta was refused, or `ok`. */
export type BalanceVerdictKind = "above-maximum" | "below-minimum" | "ok" | "over-cap";

/** Preflight or post-run judgement. `message` is safe to print. */
export type BalanceJudgement = {
  readonly kind: BalanceVerdictKind;
  readonly message: string;
  readonly strkDelta: bigint;
  readonly usdcDelta: bigint;
};

/** Standard-tier STRK window: minimum, maximum, per-run cap. */
export const STANDARD_STRK_LIMITS = { cap: "0.2", max: "2", min: "0.05" } as const;
/** Standard-tier native USDC window: minimum, maximum, per-run cap. */
export const STANDARD_USDC_LIMITS = { cap: "0.05", max: "5", min: "0.02" } as const;
/**
 * STRK20-tier STRK window. The lifecycle can spend about four pool fees plus
 * a small deposit; 22 STRK is the per-run cap and 30 STRK is still refused.
 */
export const STRK20_STRK_LIMITS = { cap: "22", max: "30", min: "21" } as const;

const strkRaw = (amount: string): bigint => parseTokenAmount(amount, STRK_TOKEN_DECIMALS);
const usdcRaw = (amount: string): bigint => parseTokenAmount(amount, USDC_DECIMALS);

const strkCeiling = (limits: {
  readonly cap: string;
  readonly max: string;
  readonly min: string;
}): TokenCeiling => ({
  capRaw: strkRaw(limits.cap),
  decimals: STRK_TOKEN_DECIMALS,
  maxRaw: strkRaw(limits.max),
  minRaw: strkRaw(limits.min),
  symbol: "STRK",
});

const usdcCeiling = (limits: {
  readonly cap: string;
  readonly max: string;
  readonly min: string;
}): TokenCeiling => ({
  capRaw: usdcRaw(limits.cap),
  decimals: USDC_DECIMALS,
  maxRaw: usdcRaw(limits.max),
  minRaw: usdcRaw(limits.min),
  symbol: "USDC",
});

const STANDARD_CEILINGS: SpendCeilings = {
  strk: strkCeiling(STANDARD_STRK_LIMITS),
  usdc: usdcCeiling(STANDARD_USDC_LIMITS),
};

const STRK20_CEILINGS: SpendCeilings = {
  strk: strkCeiling(STRK20_STRK_LIMITS),
  usdc: usdcCeiling(STANDARD_USDC_LIMITS),
};

/**
 * Parses the tier the workflow passes. Empty means the standard hot-wallet
 * cap. Any other spelling is refused rather than treated as a larger cap.
 */
export const parseSpendTier = (value: string | undefined): SpendTier => {
  if (value === undefined || value.length === 0 || value === "standard") return "standard";
  if (value === "strk20") return "strk20";
  throw new Error("MAINNET_E2E_SPEND_TIER must be standard or strk20");
};

/** Ceilings for `tier`. */
export const spendCeilings = (tier: SpendTier): SpendCeilings => {
  switch (tier) {
    case "standard":
      return STANDARD_CEILINGS;
    case "strk20":
      return STRK20_CEILINGS;
    default: {
      const unexpected: never = tier;
      throw new Error(`Unknown spend tier ${String(unexpected)}`);
    }
  }
};

/**
 * Decimal rendering of a signed raw amount. Positive is a spend. The text
 * matches `formatTokenAmount` with a leading minus when the balance rose.
 */
export const formatSignedAmount = (raw: bigint, decimals: number): string =>
  raw < 0n ? `-${formatTokenAmount(-raw, decimals)}` : formatTokenAmount(raw, decimals);

type Problem = { readonly kind: Exclude<BalanceVerdictKind, "ok">; readonly message: string };

const holdingProblem = (
  raw: bigint,
  ceiling: TokenCeiling,
  rule: "maximum-only" | "minimum-and-maximum",
): Problem | null => {
  const rendered = formatTokenAmount(raw, ceiling.decimals);
  if (rule === "minimum-and-maximum" && raw < ceiling.minRaw) {
    return {
      kind: "below-minimum",
      message: `Hot wallet ${ceiling.symbol} balance ${rendered} is below the ${formatTokenAmount(ceiling.minRaw, ceiling.decimals)} minimum. Fund this account before rerunning.`,
    };
  }
  if (raw > ceiling.maxRaw) {
    return {
      kind: "above-maximum",
      message: `Hot wallet ${ceiling.symbol} balance ${rendered} is above the ${formatTokenAmount(ceiling.maxRaw, ceiling.decimals)} maximum. Move funds off this account before rerunning.`,
    };
  }
  return null;
};

const spendProblem = (
  before: bigint,
  after: bigint,
  ceiling: TokenCeiling,
): { readonly deltaRaw: bigint; readonly problem: Problem | null } => {
  const deltaRaw = before - after;
  if (deltaRaw > ceiling.capRaw) {
    return {
      deltaRaw,
      problem: {
        kind: "over-cap",
        message: `Hot wallet ${ceiling.symbol} spend ${formatTokenAmount(deltaRaw, ceiling.decimals)} exceeds the ${formatTokenAmount(ceiling.capRaw, ceiling.decimals)} per-run cap.`,
      },
    };
  }
  return { deltaRaw, problem: null };
};

/**
 * Judges a preflight reading, or a post-run pair, against `tier`.
 *
 * Preflight checks the starting balance against the minimum and maximum and
 * ignores deltas. Post-run checks the spend against the per-run cap and that
 * the ending balance is not above the maximum. It does not apply the starting
 * minimum: a normal run spends, so the ending balance may fall below the
 * minimum the next preflight requires. The first problem's kind is the
 * verdict; every problem is included in `message`.
 */
export const judgeBalances = (input: {
  readonly after: BalancePair;
  readonly before: BalancePair;
  readonly phase: "post" | "preflight";
  readonly tier: SpendTier;
}): BalanceJudgement => {
  const ceilings = spendCeilings(input.tier);
  const observed = input.phase === "preflight" ? input.before : input.after;
  const problems: Problem[] = [];
  const holdingRule = input.phase === "preflight" ? "minimum-and-maximum" : "maximum-only";
  const strkHolding = holdingProblem(observed.strk, ceilings.strk, holdingRule);
  const usdcHolding = holdingProblem(observed.usdc, ceilings.usdc, holdingRule);
  if (strkHolding) problems.push(strkHolding);
  if (usdcHolding) problems.push(usdcHolding);
  let strkDelta = 0n;
  let usdcDelta = 0n;
  if (input.phase === "post") {
    const strkSpend = spendProblem(input.before.strk, input.after.strk, ceilings.strk);
    const usdcSpend = spendProblem(input.before.usdc, input.after.usdc, ceilings.usdc);
    strkDelta = strkSpend.deltaRaw;
    usdcDelta = usdcSpend.deltaRaw;
    if (strkSpend.problem) problems.push(strkSpend.problem);
    if (usdcSpend.problem) problems.push(usdcSpend.problem);
  }
  const first = problems[0];
  if (first === undefined) {
    return {
      kind: "ok",
      message: "Hot-wallet balances are within the spend policy.",
      strkDelta,
      usdcDelta,
    };
  }
  return {
    kind: first.kind,
    message: problems.map((problem) => problem.message).join(" "),
    strkDelta,
    usdcDelta,
  };
};
