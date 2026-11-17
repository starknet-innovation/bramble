/** Shared fail-closed response for wallet-initiated network-fee reviews. */

import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { RuntimeResponse } from "../runtime/runtime-types";

/**
 * Refusal shared by approval executors when no displayed fee can bind consent.
 */
export const FEE_REVIEW_REQUIRED: RuntimeResponse = {
  error: "retry the fee estimate before approving this transaction",
};

/**
 * Returns the exact fee a wallet surface must show before it may submit.
 * Estimation failure is a refusal: no wallet-initiated signing lane may turn a
 * missing quote into authority for the configured RPC to choose any bounds.
 */
export const requiredFeeReview = async (
  estimate: () => Promise<FeeEstimate>,
): Promise<RuntimeResponse> => {
  try {
    return { feeReview: await estimate(), ok: true };
  } catch {
    return {
      error: "Couldn't estimate the network fee, so nothing was signed. Try again.",
    };
  }
};
