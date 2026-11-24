/**
 * The displayed-fee check every live suite runs before it confirms: a review
 * whose fee is missing, not in STRK, or above the suite's cap is never submitted.
 */
import { parseTokenAmount } from "@bramble/starknet/rpc";
import { STRK_TOKEN_DECIMALS } from "@bramble/wallet-model/networks";

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
 * Reads the shared "Estimated fee:" line against `maxFeeStrk`, a decimal STRK
 * cap each suite fixes in code. Anything that is not a STRK figure is
 * `missing`, which callers treat as a refusal.
 */
export const checkDisplayedStrkFee = (text: string, maxFeeStrk: string): FeeCapCheck => {
  const match = /Estimated fee: ([0-9]+(?:\.[0-9]+)?) STRK/u.exec(text);
  const amount = match?.[1];
  if (amount === undefined) {
    return { kind: "missing" };
  }
  const raw = decimalRaw(amount);
  if (raw === null) {
    return { kind: "missing" };
  }
  return raw <= parseTokenAmount(maxFeeStrk, STRK_TOKEN_DECIMALS)
    ? { kind: "ok", raw }
    : { kind: "over", raw };
};
