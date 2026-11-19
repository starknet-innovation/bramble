/**
 * Hard spend caps for the local mainnet wallet suite. Amounts are fixed in
 * code so an environment variable cannot raise them. A self-transfer's
 * principal returns to the same account; the cap bounds the fee.
 */
import { parseTokenAmount } from "@bramble/starknet/rpc";

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
