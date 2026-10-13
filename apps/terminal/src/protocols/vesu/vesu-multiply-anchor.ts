/**
 * Anchors a Vesu Multiply swap cap to an independent price (Sherlock 147,
 * #646). The Ekubo quoter reports the input a route needs, and that input
 * (plus slippage) becomes `lever_swap_limit_amount`, the most the position may
 * spend on the swap. A quoter that inflates the input therefore raises the
 * cap. This check values the exact output at reference USD prices from a
 * source other than the quoter and refuses a cap more than
 * {@link VESU_MULTIPLY_MAX_PREMIUM_BPS} plus the quote's slippage above that
 * mid-price input. It fails closed: a missing, non-finite or non-positive
 * price, a price read that throws, or unusable decimals refuse the route. The
 * quote functions run it when quoting; screens run
 * {@link recheckVesuMultiplyQuote} again right before wallet handoff (#270).
 */
import { WalletError } from "../support/errors";
import type { VesuMultiplyExactOutQuote } from "./vesu-multiply";

/** Largest premium over the reference mid-price a swap cap may carry, before slippage. */
export const VESU_MULTIPLY_MAX_PREMIUM_BPS = 1_000;

/**
 * Reads an independent USD price for a token contract, or null when none is
 * available. It must not come from the Ekubo quoter whose route it checks.
 */
export type VesuReferenceUsdPrice = (asset: string) => Promise<number | null>;

/** Each Multiply leg's decimals and the independent price reader for the anchor. */
export type VesuMultiplyAnchor = {
  readonly collateralDecimals: number;
  readonly debtDecimals: number;
  readonly priceUsd: VesuReferenceUsdPrice;
};

type AnchorLeg = { readonly address: string; readonly decimals: number };

/**
 * A Multiply quote that passed the price anchor, carrying what the handoff
 * re-check needs: both legs and the refusal its quote function uses when no
 * price is available.
 */
export type VesuMultiplyAnchoredQuote = VesuMultiplyExactOutQuote & {
  readonly anchor: {
    readonly calculated: AnchorLeg;
    readonly specified: AnchorLeg;
    readonly unpricedMessage: string;
  };
};

const scaledPrice = (value: number | null): bigint | null => {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  // Both prices share the 1e18 scale, so it cancels in the ratio below.
  const scaled = BigInt(Math.round(value * 1e18));
  return scaled > 0n ? scaled : null;
};

const validDecimals = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= 36;

/**
 * Re-checks an anchored quote's swap cap against fresh reference prices.
 * Throws the quote's existing refusals: its unpriced message when no price is
 * available, and the route amount mismatch when the cap exceeds the premium.
 */
export const recheckVesuMultiplyQuote = async (
  quote: VesuMultiplyAnchoredQuote,
  priceUsd: VesuReferenceUsdPrice,
): Promise<void> => {
  const { calculated, specified, unpricedMessage } = quote.anchor;
  if (!validDecimals(calculated.decimals) || !validDecimals(specified.decimals)) {
    throw new WalletError(unpricedMessage);
  }
  const [specifiedPrice, calculatedPrice] = await Promise.all([
    priceUsd(specified.address).then(scaledPrice, () => null),
    priceUsd(calculated.address).then(scaledPrice, () => null),
  ]);
  if (specifiedPrice === null || calculatedPrice === null) {
    throw new WalletError(unpricedMessage);
  }
  const allowedBps = BigInt(10_000 + VESU_MULTIPLY_MAX_PREMIUM_BPS + quote.slippageBps);
  // Mid-price input for the exact output, raised by the premium and slippage:
  // output × P(specified) / P(calculated), moved between the two decimal bases.
  const allowedInput =
    (quote.outputAmount * specifiedPrice * 10n ** BigInt(calculated.decimals) * allowedBps) /
    (calculatedPrice * 10n ** BigInt(specified.decimals) * 10_000n);
  if (quote.maxInputAmount > allowedInput) {
    throw new WalletError("Ekubo Multiply route amount mismatch");
  }
};

/**
 * Attaches the legs to a parsed quote and anchors it. `specified` is the exact
 * output token and `calculated` the input token the quoter priced it in.
 */
export const anchorVesuMultiplyQuote = async (
  quote: VesuMultiplyExactOutQuote,
  legs: { readonly calculated: AnchorLeg; readonly specified: AnchorLeg },
  unpricedMessage: string,
  priceUsd: VesuReferenceUsdPrice,
): Promise<VesuMultiplyAnchoredQuote> => {
  const anchored = { ...quote, anchor: { ...legs, unpricedMessage } };
  await recheckVesuMultiplyQuote(anchored, priceUsd);
  return anchored;
};
