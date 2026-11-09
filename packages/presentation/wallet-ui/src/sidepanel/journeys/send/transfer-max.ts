/**
 * What Max and Half may fill for the composed send (mc-wallet 720).
 *
 * A public STRK send pays its network fee in STRK too, so filling the whole
 * balance leaves nothing for the fee and the send fails. Max therefore keeps
 * back the most the wallet will sign for this send: the reviewed fee (plus the
 * account's deployment when it must deploy first) raised by the same headroom
 * the submission is held to. Every other route and token is unchanged.
 */

import { reviewedFeeCeiling, sumFeeEstimates } from "@bramble/starknet/fee-bounds";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import { type TransferRouteContext, transferRoute, transferSpendable } from "./transfer-route";
import type { TransferReview } from "./transfer-submit";

/** True when the composed send pays its network fee from the amount's own balance. */
export const paysFeeFromAmount = (context: TransferRouteContext): boolean =>
  transferRoute(context.fields).id === "public-public" &&
  sameFelt(context.fields.tokenAddress, STRK_TOKEN_ADDRESS);

/**
 * The STRK a public send must keep back for its fee, in base units, or `null`
 * while that fee is not known: no review yet, a failed estimate, a deployment
 * whose fee is missing, or a figure that is not in FRI. Never a guess.
 */
export const feeReserveFor = (review: TransferReview | null): bigint | null => {
  if (review === null || review.feeEstimateFailed || review.fee === null) {
    return null;
  }
  let total = review.fee;
  if (review.requiresDeployment) {
    if (review.deploymentFeeEstimateFailed === true || !review.deploymentFee) {
      return null;
    }
    const combined = sumFeeEstimates(review.fee, review.deploymentFee);
    if (combined === null) {
      return null;
    }
    total = combined;
  }
  return total.unit === "FRI" ? reviewedFeeCeiling(total) : null;
};

/**
 * The largest amount Max may fill, in raw units, or `null` to withhold Max and
 * Half. For a public STRK send it is the spendable balance less
 * {@link feeReserveFor}, and `null` while that reserve is unknown; it never
 * goes below zero. Otherwise it is the route's spendable amount as before.
 */
export const transferMaxSpendable = (
  context: TransferRouteContext,
  review: TransferReview | null,
): bigint | null => {
  const spendable = transferSpendable(context);
  if (spendable === null || !paysFeeFromAmount(context)) {
    return spendable;
  }
  const reserve = feeReserveFor(review);
  if (reserve === null) {
    return null;
  }
  return spendable > reserve ? spendable - reserve : 0n;
};
