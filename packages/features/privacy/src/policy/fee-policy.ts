/** STRK20 pool-fee parsing and bounds shared by preparation and submission. */

import { WalletError } from "@bramble/core/errors";
import { type StarknetNetworkId, UINT128_LIMIT } from "@bramble/wallet-model/networks";

/**
 * Stable refusal for missing or malformed SDK/service routing; callers fail
 * closed without proving, signing, or submitting.
 */
export const STRK20_SERVICE_UNAVAILABLE = "strk20 services unavailable";

/**
 * Maximum accepted pool fee, single-sourced from the uint256 limb bound so
 * protocol field limits cannot drift across layers.
 */
export const STRK20_MAX_POOL_FEE = UINT128_LIMIT - 1n;

/**
 * Parses a reviewed pool fee into canonical felt form. Malformed, negative, or
 * out-of-range service values fail closed before entering an approval digest.
 */
export const canonicalStrk20PoolFee = (value: string): string => {
  let fee: bigint;
  try {
    fee = BigInt(value);
  } catch {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  if (fee < 0n || fee > STRK20_MAX_POOL_FEE) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  return `0x${fee.toString(16)}`;
};

/**
 * Multiplier applied to an independent reference price to bound a relay-quoted
 * converted fee. The relay both quotes the conversion and receives its
 * proceeds, so on a non-STRK fee token there is no on-chain value to match the
 * quote against the way {@link canonicalStrk20PoolFee} matches the STRK route.
 * A band rather than an equality is required because the reference and the
 * relay price the same pair from different sources at different instants; it is
 * deliberately loose, because its job is to refuse a drain, not to arbitrage a
 * spread. Single-sourced: policy, review text, and tests all read this value.
 */
export const STRK20_FEE_CEILING_MULTIPLIER = 2n;

/**
 * Stable refusal for a converted fee the wallet could not bound. Raised when no
 * independent reference price is available for the configured fee token, which
 * fails the route closed rather than falling back to the relay's own number.
 */
export const STRK20_FEE_UNVERIFIABLE = "strk20 converted fee could not be verified independently";

/**
 * Stable refusal for a converted fee quoted above its reviewed ceiling.
 */
export const STRK20_FEE_ABOVE_CEILING = "strk20 relay fee exceeds the reviewed ceiling";

/**
 * Highest converted fee acceptable for `reference` base units of the fee token.
 *
 * `reference` is the fee token amount an independent price source says the
 * pool's on-chain STRK charge is worth. A non-positive reference yields a zero
 * ceiling, so an empty or malformed reference refuses every quote instead of
 * admitting one unbounded.
 */
export const strk20ConvertedFeeCeiling = (reference: bigint): bigint =>
  reference > 0n ? reference * STRK20_FEE_CEILING_MULTIPLIER : 0n;

/**
 * Independent second opinion on what the pool's STRK charge is worth in the
 * configured fee token, used only to bound a relay-quoted converted fee.
 *
 * Supplied by the composition root rather than resolved here: pricing lives
 * outside this package's dependency graph, and the point of the bound is that
 * it does not come from the relay being bounded. Implementations must not
 * consult the paymaster.
 *
 * Returns the reference amount in the fee token's base units, or `null` when no
 * independent price is available — which fails the converted route closed
 * rather than admitting an unbounded quote.
 */
export type Strk20FeeReference = (input: {
  readonly feeToken: string;
  readonly networkId: StarknetNetworkId;
  readonly poolFeeFri: bigint;
}) => Promise<bigint | null>;

/**
 * How a relay-quoted fee is checked before it is proved.
 *
 * `exact` is the STRK route: the pool's own charge is readable on-chain, so the
 * quote must equal it and no trust in the relay is involved. `ceiling` is the
 * converted route, where no on-chain value denominates the quote and the best
 * available check is {@link strk20ConvertedFeeCeiling} over an independent
 * {@link Strk20FeeReference}. `reference` is carried alongside so the reviewed
 * plan can record what the bound was derived from.
 */
export type Strk20FeeBound =
  | { readonly amount: bigint; readonly kind: "exact" }
  | { readonly ceiling: bigint; readonly kind: "ceiling"; readonly reference: bigint };
