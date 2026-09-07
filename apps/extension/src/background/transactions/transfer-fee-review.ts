/** Separate invoke/deployment fee review for wallet-funded direct transfers. */

import { type FeeEstimate, sumFeeEstimates } from "@bramble/starknet/fee-bounds";
import type { FeeSpeed } from "@bramble/starknet/rpc-submit";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { Call } from "starknet";
import type { RuntimeRpc } from "../runtime/runtime-rpc";

/**
 * Exact fee components required before an invoke may auto-deploy its account.
 * A failed component is null and blocks submission rather than being guessed.
 */
export type WalletFundedFeeReview = {
  readonly deploymentFee: FeeEstimate | null;
  readonly deploymentFeeEstimateFailed: boolean;
  readonly fee: FeeEstimate | null;
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
      feeEstimateFailed: true,
      requiresDeployment: true,
      totalFee: null,
    };
  }
  const [fee, deploymentFee] = await Promise.all([
    runtimeRpc
      .estimateInvokeFee({
        account: input.account,
        calls: input.calls,
        rpcUrls: input.rpcUrls,
        signHash: input.signHash,
        ...(input.speed ? { speed: input.speed } : {}),
      })
      .catch(() => null),
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
    feeEstimateFailed: fee === null,
    requiresDeployment,
    totalFee,
  };
};
