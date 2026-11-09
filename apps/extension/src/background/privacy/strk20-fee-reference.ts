/**
 * Independent reference price for bounding a converted STRK20 relay fee.
 *
 * The privacy package defines the port and the band; this supplies the one
 * number it cannot source for itself. It lives here because pricing is not in
 * `@bramble/privacy`'s dependency graph, and because the whole point of the
 * bound is that it comes from somewhere other than the relay being bounded —
 * so this must never consult the paymaster.
 *
 * Every unknown fails closed by returning `null`: an unlisted token, a missing
 * or non-positive price, a price snapshot the feed could not refresh, or
 * decimals outside the range a real ERC20 declares. The caller turns that into
 * a refused route, never an unbounded quote.
 */

import type { PriceService } from "@bramble/portfolio/prices";
import { knownTokensForNetwork } from "@bramble/portfolio/token-registry";
import type {
  Strk20FeeAsset,
  Strk20FeeReference,
  Strk20SubmissionPlan,
} from "@bramble/privacy/service";
import {
  STRK_TOKEN_ADDRESS,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";

/**
 * Currency the two legs are compared in. Which one does not matter — it
 * cancels — so this is pinned rather than read from display preferences, so a
 * user's currency choice cannot move a security bound.
 */
const REFERENCE_CURRENCY = "usd" as const;

// Fiat prices arrive as floats. Scaling both legs to integers keeps the ratio
// in bigint arithmetic; the scale cancels, so it only sets precision. 1e6 holds
// six significant figures on a sub-dollar token while leaving a five-figure
// one (WBTC) far inside the safe-integer range.
const PRICE_SCALE = 1_000_000;

// Wider than any ERC20 in circulation, and narrow enough that 10**n cannot be
// used to force a pathological allocation from a malformed registry entry.
const MAX_TOKEN_DECIMALS = 36;

const scaledPrice = (value: number | undefined): bigint | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const scaled = Math.round(value * PRICE_SCALE);
  if (!Number.isSafeInteger(scaled) || scaled <= 0) {
    return null;
  }
  return BigInt(scaled);
};

// Keys come from the price feed's own canonicalization, so match on felt value
// rather than string identity; a padding difference must not read as "unpriced"
// and silently refuse a legitimate route.
const priceFor = (prices: Readonly<Record<string, number>>, address: string): number | undefined =>
  Object.entries(prices).find(([key]) => sameFelt(key, address))?.[1];

const usableDecimals = (decimals: number): boolean =>
  Number.isInteger(decimals) && decimals >= 0 && decimals <= MAX_TOKEN_DECIMALS;

/**
 * Builds the reference from the wallet's existing fiat price feed.
 *
 * Returns what `poolFeeFri` of STRK is worth in `feeToken` base units, or
 * `null` when either leg cannot be priced from the registry and feed alone.
 */
export const createStrk20FeeReference = (prices: PriceService): Strk20FeeReference => {
  const tokenFor = (networkId: StarknetNetworkId, address: string) =>
    knownTokensForNetwork(networkId).find((token) => sameFelt(token.address, address));
  return async ({ feeToken, networkId, poolFeeFri }) => {
    const strk = tokenFor(networkId, STRK_TOKEN_ADDRESS);
    const fee = tokenFor(networkId, feeToken);
    if (!strk || !fee || !usableDecimals(strk.decimals) || !usableDecimals(fee.decimals)) {
      return null;
    }
    const quote = await prices.getPrices({
      addresses: [strk.address, fee.address],
      currency: REFERENCE_CURRENCY,
      networkId,
    });
    // When the feed is unreachable it serves its last-known-good snapshot with
    // `stale` set and no age limit. A months-old high STRK rate would let the
    // relay charge far above the intended ceiling, so only a snapshot the feed
    // vouches for as current may bound a fee; the route then falls back to
    // the configured token's exact bound.
    if (quote.stale || quote.asOf === null) {
      return null;
    }
    const strkPrice = scaledPrice(priceFor(quote.prices, strk.address));
    const feePrice = scaledPrice(priceFor(quote.prices, fee.address));
    if (strkPrice === null || feePrice === null || poolFeeFri <= 0n) {
      return null;
    }
    // poolFeeFri * strkUsd / feeUsd, rebased from STRK's decimals onto the fee
    // token's. The price scale cancels between the two legs.
    return (
      (poolFeeFri * strkPrice * 10n ** BigInt(fee.decimals)) /
      (feePrice * 10n ** BigInt(strk.decimals))
    );
  };
};

/**
 * Display metadata for the fee a reviewed plan will charge, or `undefined` on
 * the account route and for a token the registry does not describe.
 *
 * Resolved from the same registry the bound above is derived from, so the
 * amount a user reads and the ceiling it was checked against are denominated
 * by one source. Preferences are deliberately not consulted: the fee token is
 * wallet-configured routing, not something the user's tracked-token list
 * should be able to relabel.
 */
export const strk20FeeAssetFor = (
  networkId: StarknetNetworkId,
  plan: Strk20SubmissionPlan,
): Strk20FeeAsset | undefined => {
  if (plan.mode === "account") {
    return undefined;
  }
  const token = knownTokensForNetwork(networkId).find((entry) =>
    sameFelt(entry.address, plan.feeAction.token),
  );
  return token ? { decimals: token.decimals, symbol: token.symbol } : undefined;
};
