/**
 * Hard spend caps for the local mainnet wallet suite. Amounts are fixed in
 * code so an environment variable cannot raise them. A self-transfer's
 * principal returns to the same account; the cap bounds the fee.
 */
import { parseTokenAmount } from "@bramble/starknet/rpc";
import { STRK_TOKEN_DECIMALS } from "@bramble/wallet-model/networks";

/** Decimal STRK/ETH moved to the same account. Small enough to be dust. */
export const SELF_TRANSFER_AMOUNT = "0.000001";

/** Displayed STRK fee above this is not submitted. */
export const MAX_TX_FEE_STRK = "0.02";

/**
 * Human-unit ceilings for a gasless fee quote, keyed by the wallet's symbol.
 * A symbol that is not listed is never paid. STRK is absent on purpose: the
 * ordinary review already prices that fee, and the gasless path must not
 * spend it again.
 */
const GASLESS_HUMAN_CAP: Readonly<Record<string, string>> = {
  DAI: "0.02",
  ETH: "0.00002",
  USDC: "0.02",
  USDT: "0.02",
  WBTC: "0.000002",
};

/**
 * Raw base units of {@link SELF_TRANSFER_AMOUNT} for a token with `decimals`.
 */
export const selfTransferRaw = (decimals: number): bigint =>
  parseTokenAmount(SELF_TRANSFER_AMOUNT, decimals);

const feeCapRaw = (): bigint => parseTokenAmount(MAX_TX_FEE_STRK, STRK_TOKEN_DECIMALS);

const decimalRaw = (amount: string): bigint | null => {
  if (/^0(?:\.0+)?$/u.test(amount)) {
    return 0n;
  }
  try {
    return parseTokenAmount(amount, STRK_TOKEN_DECIMALS);
  } catch {
    return null;
  }
};

/** A displayed STRK fee the suite is willing to submit. */
export type FeeCapCheck =
  | { readonly kind: "missing" }
  | { readonly kind: "ok"; readonly raw: bigint }
  | { readonly kind: "over"; readonly raw: bigint };

/**
 * Reads the shared "Estimated fee:" line. Anything that is not a STRK figure
 * is `missing`, which callers treat as a refusal.
 */
export const checkDisplayedStrkFee = (text: string): FeeCapCheck => {
  const match = /Estimated fee: ([0-9]+(?:\.[0-9]+)?) STRK/u.exec(text);
  const amount = match?.[1];
  if (amount === undefined) {
    return { kind: "missing" };
  }
  const raw = decimalRaw(amount);
  if (raw === null) {
    return { kind: "missing" };
  }
  return raw <= feeCapRaw() ? { kind: "ok", raw } : { kind: "over", raw };
};

/**
 * Whether a gasless offer's raw `amount` is inside the symbol's ceiling.
 * Malformed amounts and unknown symbols are refused.
 */
export const gaslessOfferWithinCap = (offer: {
  readonly amount: string;
  readonly decimals: number;
  readonly label: string;
}): boolean => {
  const cap = GASLESS_HUMAN_CAP[offer.label];
  if (cap === undefined || !/^[0-9]+$/u.test(offer.amount)) {
    return false;
  }
  let quoted: bigint;
  try {
    quoted = BigInt(offer.amount);
    return quoted > 0n && quoted <= parseTokenAmount(cap, offer.decimals);
  } catch {
    return false;
  }
};
