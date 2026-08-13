/**
 * The fee a user reviewed, and the ceiling a submission may sign under it.
 *
 * A wallet that shows "Estimated fee: X" and then signs whatever the node
 * quotes at broadcast time has told the user nothing binding. The gap is
 * reachable on purpose: the gas a call burns can depend on state the requesting
 * site controls, so a dapp can show a cheap estimate, wait for the click, and
 * flip that state while the review screen is open. Nothing about the reviewed
 * figure constrains what gets signed unless something carries it into the
 * submission and refuses on a mismatch — which is what this module is for.
 *
 * Pure, and deliberately narrow: it compares two estimates of the same
 * quantity, taken the same way, and says whether the later one has outrun the
 * consent the earlier one bought. It never decides what to do about that; the
 * submit boundary (`./rpc-submit`) fails closed on a true answer.
 *
 * The quantity being compared is deliberately NOT the node's headline fee. What
 * a signed transaction authorises is its resource bounds — `max_amount x
 * max_price_per_unit`, summed over the resources — and a lane that scales those
 * bounds up after checking the headline figure has checked a number it will not
 * sign. So the comparison here is always against the spend the bounds imply,
 * for the speed those bounds will be built at.
 */
import { WalletError } from "@mc-wallet/core/errors";
import { isBaseUnitsAmount, isRecord } from "@mc-wallet/core/json";
import {
  type FeeEstimate,
  isFeeEstimate,
  isFeeUnit,
} from "@mc-wallet/wallet-protocol/fee-estimate";

export { type FeeEstimate, isFeeEstimate } from "@mc-wallet/wallet-protocol/fee-estimate";

/**
 * Reports whether two estimates state the same fee in the same denomination.
 *
 * Exact equality, deliberately without the tolerance {@link exceedsReviewedFee}
 * applies: this is the comparison a surface's echoed figure is judged by, and
 * the question there is "is the wallet still holding the number the user read",
 * not "is the difference small". A moved figure, a different unit, or a figure
 * that has since been cleared all read as a change, because consent bought for
 * one number does not carry over to another. Both sides are validated
 * {@link FeeEstimate}s, so the comparison is on the canonical base-units
 * spelling {@link isFeeEstimate} admits.
 */
export const sameFeeEstimate = (left: FeeEstimate, right: FeeEstimate): boolean =>
  left.overallFee === right.overallFee && left.unit === right.unit;

/**
 * Adds two reviewed fee components without crossing denominations. Returns
 * null for malformed inputs or unlike units so a displayed total fails closed.
 */
export const sumFeeEstimates = (left: FeeEstimate, right: FeeEstimate): FeeEstimate | null =>
  isFeeEstimate(left) && isFeeEstimate(right) && left.unit === right.unit
    ? {
        overallFee: (BigInt(left.overallFee) + BigInt(right.overallFee)).toString(),
        unit: left.unit,
      }
    : null;

/**
 * How far above the reviewed figure a submission-time estimate may land before
 * the wallet refuses to sign, as an exact rational (numerator/denominator) so
 * the comparison stays integer arithmetic on base units.
 *
 * It is headroom, not slack. Two legitimate differences live inside it: gas
 * prices genuinely move between the moment the card is drawn and the moment the
 * user clicks, and the reviewed estimate is taken with `skipValidate` (so a
 * review can never open a Ledger prompt) while the signed one includes the
 * account's `__validate__`. Both are bounded, small, and in the same direction.
 * What the headroom is NOT is a licence for the cost to move without limit,
 * which is the whole of the exposure — 50% over a fee the user saw is a
 * different thing from an arbitrary multiple of it.
 */
export const REVIEWED_FEE_HEADROOM = {
  denominator: 2,
  numerator: 3,
} as const;

const baseUnits = (value: string): bigint | null =>
  isBaseUnitsAmount(value) ? BigInt(value) : null;

/**
 * Decides whether a submission-time estimate has outrun the fee the user
 * reviewed, by more than {@link REVIEWED_FEE_HEADROOM}.
 *
 * Fails closed on anything it cannot compare: a different fee unit (the two
 * figures are then not the same quantity at all) or a value that is not a
 * decimal base-units integer both answer `true`, because "we could not check"
 * must never read as "we checked and it was fine".
 */
export const exceedsReviewedFee = (reviewed: FeeEstimate, quoted: FeeEstimate): boolean => {
  if (reviewed.unit !== quoted.unit) {
    return true;
  }
  const ceiling = baseUnits(reviewed.overallFee);
  const actual = baseUnits(quoted.overallFee);
  if (ceiling === null || actual === null) {
    return true;
  }
  return (
    actual * BigInt(REVIEWED_FEE_HEADROOM.denominator) >
    ceiling * BigInt(REVIEWED_FEE_HEADROOM.numerator)
  );
};

/**
 * Fee speed control: `standard` signs the bounds the node's own estimate
 * implies, `fast` signs {@link FAST_BOUND_SCALE}-scaled bounds for faster
 * inclusion. Defined here rather than at the submit boundary because the review
 * that prices a send and the submission that signs it must read the same word
 * the same way — the number a user is shown depends on it.
 */
export type FeeSpeed = "fast" | "standard";

/**
 * How far above the node's own estimate a `fast` send lifts its resource
 * bounds. Applied to EACH dimension (`max_amount` and `max_price_per_unit`), so
 * the spend a fast send authorises rises by the square of it — which is
 * exactly why the reviewed figure must be compared against the scaled bounds
 * and never against the estimate they were scaled from.
 */
export const FAST_BOUND_SCALE = {
  denominator: 2,
  numerator: 3,
} as const;

// A decimal or 0x-prefixed integer, the two spellings resource bounds arrive in.
const INTEGER_PATTERN = /^(?:0x[0-9a-fA-F]+|[0-9]+)$/;

/**
 * The node-side fee estimate this module reads: starknet.js's `EstimateFee`,
 * described structurally so nothing here depends on the library's class.
 * `overall_fee` is the node's headline figure and `resourceBounds` the mapping
 * the signed transaction would actually carry.
 */
export type NodeFeeEstimate = {
  readonly overall_fee: bigint | number | string;
  readonly resourceBounds?: unknown;
  readonly unit?: unknown;
};

const integerOf = (value: unknown): bigint | null => {
  if (typeof value === "bigint") {
    return value >= 0n ? value : null;
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  return typeof value === "string" && INTEGER_PATTERN.test(value) ? BigInt(value) : null;
};

const scaled = (value: bigint): bigint =>
  (value * BigInt(FAST_BOUND_SCALE.numerator)) / BigInt(FAST_BOUND_SCALE.denominator);

/**
 * Scales every integer in a resource-bounds mapping by {@link FAST_BOUND_SCALE},
 * preserving each value's original spelling (bigint, decimal, or `0x`) so the
 * result can be handed straight back to starknet.js.
 *
 * Structural on purpose: the mapping's resource names are the node's, not the
 * wallet's, so a spec revision that adds a resource is scaled too rather than
 * silently left at the unscaled value. Anything it cannot read as an integer is
 * passed through untouched — {@link feeBoundsMaxSpend} is what decides whether
 * the result is still something the wallet is willing to sign under.
 */
export const scaleFeeBounds = (value: unknown): unknown => {
  if (typeof value === "bigint") {
    return scaled(value);
  }
  if (typeof value === "string" && INTEGER_PATTERN.test(value)) {
    const lifted = scaled(BigInt(value));
    return value.startsWith("0x") ? `0x${lifted.toString(16)}` : lifted.toString();
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, scaleFeeBounds(entry)]),
    );
  }
  return value;
};

/**
 * The maximum spend a resource-bounds mapping authorises: the sum of
 * `max_amount x max_price_per_unit` over every resource in it.
 *
 * This — not the node's headline `overall_fee` — is what a signed transaction
 * actually lets a sequencer take. Returns null for a mapping it cannot read in full (an
 * unexpected shape, a missing or non-integer field, or no resources at all),
 * because a partial sum would understate the authority being granted; callers
 * treat null as "cannot verify" and fail closed rather than substituting the
 * headline figure.
 */
export const feeBoundsMaxSpend = (bounds: unknown): bigint | null => {
  if (!isRecord(bounds)) {
    return null;
  }
  const resources = Object.values(bounds);
  if (resources.length === 0) {
    return null;
  }
  let total = 0n;
  for (const resource of resources) {
    if (!isRecord(resource)) {
      return null;
    }
    const amount = integerOf(resource["max_amount"]);
    const price = integerOf(resource["max_price_per_unit"]);
    if (amount === null || price === null) {
      return null;
    }
    total += amount * price;
  }
  return total;
};

/**
 * Reads a node fee estimate into the wallet's own shape, refusing a
 * denomination the wallet cannot reason about.
 *
 * Every fee the wallet displays or compares is produced here, so the producing
 * end and the validating end ({@link isFeeEstimate}) share one allowlist and
 * cannot disagree about what a fee is. A missing unit is read as `FRI`, the
 * Starknet default; a unit that is present but unrecognised throws a
 * {@link WalletError} at the boundary that read it, rather than travelling on to
 * be rejected somewhere with less context.
 */
export const nodeFeeEstimate = (estimate: NodeFeeEstimate): FeeEstimate => {
  const unit = typeof estimate.unit === "string" ? estimate.unit : "FRI";
  if (!isFeeUnit(unit)) {
    throw new WalletError("The node quoted this fee in an unrecognised unit.");
  }
  return { overallFee: BigInt(estimate.overall_fee).toString(), unit };
};

/**
 * The spend a submission at `speed` would authorise, given the estimate it was
 * built from: the maximum implied by the bounds that will actually be signed.
 *
 * Null means the estimate's bounds could not be read in full, so no honest
 * ceiling can be stated for it. Callers holding a reviewed fee must refuse on
 * null; callers merely pricing a review fall back to
 * {@link reviewedSpendFor}'s stated approximation.
 */
export const authorizedSpendFor = (
  estimate: NodeFeeEstimate,
  speed: FeeSpeed,
): FeeEstimate | null => {
  const { unit } = nodeFeeEstimate(estimate);
  const bounds =
    speed === "fast" ? scaleFeeBounds(estimate.resourceBounds) : estimate.resourceBounds;
  const spend = feeBoundsMaxSpend(bounds);
  return spend === null ? null : { overallFee: spend.toString(), unit };
};

/**
 * The figure a review should show for a send at `speed`: the spend that speed
 * would authorise, so the number on the card is the number the submission is
 * held to rather than a cheaper one the lane will scale away from.
 *
 * Never null — a review that cannot read the node's bounds still has to show
 * something — so the fallback is stated rather than hidden: the headline figure
 * for a standard send, and that figure raised by {@link FAST_BOUND_SCALE}
 * squared for a fast one, matching what scaling both bound dimensions costs.
 */
export const reviewedSpendFor = (estimate: NodeFeeEstimate, speed: FeeSpeed): FeeEstimate => {
  const authorized = authorizedSpendFor(estimate, speed);
  if (authorized) {
    return authorized;
  }
  const headline = nodeFeeEstimate(estimate);
  if (speed !== "fast") {
    return headline;
  }
  const square = BigInt(FAST_BOUND_SCALE.numerator) ** 2n;
  const divisor = BigInt(FAST_BOUND_SCALE.denominator) ** 2n;
  return {
    overallFee: ((BigInt(headline.overallFee) * square) / divisor).toString(),
    unit: headline.unit,
  };
};
