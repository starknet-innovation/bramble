/** Shared fail-closed response for wallet-initiated network-fee reviews. */

import type { FeeEstimate } from "@mc-wallet/starknet/fee-bounds";
import type { RuntimeResponse } from "../runtime/runtime-types";

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
      error:
        "The network fee could not be estimated. Check the RPC endpoint and retry before signing.",
    };
  }
};
