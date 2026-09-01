/** Separate invoke/deployment fee review for wallet-funded direct transfers. */

import { errorDetail } from "@mc-wallet/core/errors";
import { type FeeEstimate, sumFeeEstimates } from "@mc-wallet/starknet/fee-bounds";
import type { FeeSpeed } from "@mc-wallet/starknet/rpc-submit";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { Call } from "starknet";
import type { RuntimeRpc } from "../runtime/runtime-rpc";

/**
 * Curated summary a failed invoke estimate is reported under. Passed to
 * {@link errorDetail} so a node reason identical to the summary collapses to
 * null instead of being echoed twice, and so every review lane classifies one
 * failure the same way.
 */
export const FEE_ESTIMATE_SUMMARY = "fee estimate failed";

/**
 * Exact fee components required before an invoke may auto-deploy its account.
 * A failed component is null and blocks submission rather than being guessed.
 */
export type WalletFundedFeeReview = {
  readonly deploymentFee: FeeEstimate | null;
  readonly deploymentFeeEstimateFailed: boolean;
  readonly fee: FeeEstimate | null;
  /**
   * The node's own reason the invoke estimate was rejected, or null when there
   * is none to report. Captured here, in the one place the estimate is made, so
   * every wallet-funded review lane surfaces the same reason rather than each
   * re-deriving it. A wallet-internal diagnostic: it reaches the panel and is
   * never returned to a requesting page.
   */
  readonly feeEstimateDetail: string | null;
  readonly feeEstimateFailed: boolean;
  readonly requiresDeployment: boolean;
  readonly totalFee: FeeEstimate | null;
};

/**
 * Estimates the exact invoke and, when required, the counterfactual account
 * deployment. Neither estimate signs or broadcasts; an unreadable deployment
 * status or either missing component fails the combined review closed.
 */
export const reviewWalletFundedFees = async (
  runtimeRpc: RuntimeRpc,
  input: {
    readonly account: AccountRef;
    readonly calls: readonly Call[];
    readonly rpcUrls: readonly string[];
    readonly signHash: Parameters<RuntimeRpc["estimateInvokeFee"]>[0]["signHash"];
    readonly speed?: FeeSpeed;
  },
): Promise<WalletFundedFeeReview> => {
  const deployed = await runtimeRpc
    .getDeploymentStatus({ accountAddress: input.account.address, rpcUrls: input.rpcUrls })
    .catch(() => null);
  if (deployed === null) {
    return {
      deploymentFee: null,
      deploymentFeeEstimateFailed: true,
      fee: null,
      feeEstimateDetail: null,
      feeEstimateFailed: true,
      requiresDeployment: true,
      totalFee: null,
    };
  }
  // The node's reason for a rejected invoke estimate. `skipValidate` skips
  // `__validate__` but still executes the calls, so an estimate that reverted
  // on chain would otherwise reach the user as a connection problem.
  let feeEstimateDetail: string | null = null;
  const [fee, deploymentFee] = await Promise.all([
    runtimeRpc
      .estimateInvokeFee({
        account: input.account,
        calls: input.calls,
        rpcUrls: input.rpcUrls,
        signHash: input.signHash,
        ...(input.speed ? { speed: input.speed } : {}),
      })
      .catch((error: unknown) => {
        feeEstimateDetail = errorDetail(error, FEE_ESTIMATE_SUMMARY);
        return null;
      }),
    !deployed && runtimeRpc.estimateAccountDeploymentFee
      ? runtimeRpc
          .estimateAccountDeploymentFee({
            account: input.account,
            rpcUrls: input.rpcUrls,
            signHash: input.signHash,
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  const requiresDeployment = !deployed;
  const totalFee = requiresDeployment
    ? fee && deploymentFee
      ? sumFeeEstimates(fee, deploymentFee)
      : null
    : fee;
  return {
    deploymentFee,
    deploymentFeeEstimateFailed: requiresDeployment && deploymentFee === null,
    fee,
    // Only alongside an actual failure: a recovered estimate never ships a
    // stale reason.
    feeEstimateDetail: fee === null ? feeEstimateDetail : null,
    feeEstimateFailed: fee === null,
    requiresDeployment,
    totalFee,
  };
};
