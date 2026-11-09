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

/**
 * Why the anchor refused a route, as a stable code callers can map to
 * reviewed copy: `price_unavailable` when no independent price (or no usable
 * decimals) could be read, `price_premium_exceeded` when the swap cap is above
 * the allowed premium over the reference mid-price.
 */
type VesuMultiplyAnchorRefusal = "price_premium_exceeded" | "price_unavailable";

// Reviewed copy for the two refusals (approved 2026-10-13). Both screens and
// the wallet request dialog show an error's message as written.
const REFUSAL_COPY: Readonly<Record<VesuMultiplyAnchorRefusal, string>> = {
  price_premium_exceeded: "The swap price is too far from the market price. Try again later.",
  price_unavailable:
    "Couldn't get a market price for this swap, so it can't be checked. Try again, or choose another market.",
};

/**
 * A price-anchor refusal, carrying its reviewed sentence as the message and
 * the stable `code` that distinguishes the two cases.
 */
export class VesuMultiplyAnchorError extends WalletError {
  public readonly code: VesuMultiplyAnchorRefusal;

  public constructor(code: VesuMultiplyAnchorRefusal) {
    super(REFUSAL_COPY[code]);
    this.name = "VesuMultiplyAnchorError";
    this.code = code;
  }
}

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
 * A Multiply quote that passed the price anchor, carrying both legs, which the
 * handoff re-check needs.
 */
export type VesuMultiplyAnchoredQuote = VesuMultiplyExactOutQuote & {
  readonly anchor: {
    readonly calculated: AnchorLeg;
    readonly specified: AnchorLeg;
  };
};

// Quotes this module anchored, so a builder can refuse one that never passed
// the check (a parsed quote spread into the anchored shape is not in it).
const anchoredQuotes = new WeakSet<object>();

/**
 * Whether `quote` came out of {@link anchorVesuMultiplyQuote}. The Multiply call
 * builders refuse any other quote, so no path reaches the wallet with a swap
 * cap the anchor never checked.
 */
export const isAnchoredVesuMultiplyQuote = (
  quote: VesuMultiplyExactOutQuote,
): quote is VesuMultiplyAnchoredQuote => anchoredQuotes.has(quote);

const scaledPrice = (value: number | null): bigint | null => {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  // Both prices share the 1e18 scale, so it cancels in the ratio below.
  const scaled = BigInt(Math.round(value * 1e18));
  return scaled > 0n ? scaled : null;
};

const validDecimals = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= 36;

/**
 * Re-checks an anchored quote's swap cap against the prices `priceUsd` reads
 * (at handoff, pass an uncached reader). Throws a {@link VesuMultiplyAnchorError}:
 * `price_unavailable` when no price is available, `price_premium_exceeded`
 * when the cap exceeds the premium.
 */
export const recheckVesuMultiplyQuote = async (
  quote: VesuMultiplyAnchoredQuote,
  priceUsd: VesuReferenceUsdPrice,
): Promise<void> => {
  const { calculated, specified } = quote.anchor;
  if (!validDecimals(calculated.decimals) || !validDecimals(specified.decimals)) {
    throw new VesuMultiplyAnchorError("price_unavailable");
  }
  const [specifiedPrice, calculatedPrice] = await Promise.all([
    priceUsd(specified.address).then(scaledPrice, () => null),
    priceUsd(calculated.address).then(scaledPrice, () => null),
  ]);
  if (specifiedPrice === null || calculatedPrice === null) {
    throw new VesuMultiplyAnchorError("price_unavailable");
  }
  const allowedBps = BigInt(10_000 + VESU_MULTIPLY_MAX_PREMIUM_BPS + quote.slippageBps);
  // Mid-price input for the exact output, raised by the premium and slippage:
  // output × P(specified) / P(calculated), moved between the two decimal bases.
  const allowedInput =
    (quote.outputAmount * specifiedPrice * 10n ** BigInt(calculated.decimals) * allowedBps) /
    (calculatedPrice * 10n ** BigInt(specified.decimals) * 10_000n);
  if (quote.maxInputAmount > allowedInput) {
    throw new VesuMultiplyAnchorError("price_premium_exceeded");
  }
};

/**
 * Attaches the legs to a parsed quote and anchors it. `specified` is the exact
 * output token and `calculated` the input token the quoter priced it in.
 */
export const anchorVesuMultiplyQuote = async (
  quote: VesuMultiplyExactOutQuote,
  legs: { readonly calculated: AnchorLeg; readonly specified: AnchorLeg },
  priceUsd: VesuReferenceUsdPrice,
): Promise<VesuMultiplyAnchoredQuote> => {
  const anchored = { ...quote, anchor: legs };
  await recheckVesuMultiplyQuote(anchored, priceUsd);
  anchoredQuotes.add(anchored);
  return anchored;
};
