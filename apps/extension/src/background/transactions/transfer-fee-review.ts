/** Separate invoke/deployment fee review for wallet-funded direct transfers. */

import { UndeployedBraavosError } from "@bramble/starknet/deployment";
import { type FeeEstimate, sumFeeEstimates } from "@bramble/starknet/fee-bounds";
import type { FeeSpeed } from "@bramble/starknet/rpc-submit";
import { isDeployableBraavos } from "@bramble/wallet-model/account-families";
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
 *
 * An undeployed Braavos account is the one exception that throws: it can only
 * deploy through its own reviewed step, so the review rejects with
 * {@link UndeployedBraavosError} (whose message says to deploy first) rather
 * than degrading to a retryable "fee unavailable" no retry can fix.
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
  if (!deployed && isDeployableBraavos(input.account)) {
    throw new UndeployedBraavosError();
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
      .catch((error: unknown) => {
        // The platform's own deploy-then-act refusal, should the two
        // deployment reads disagree; every other failure stays retryable.
        if (error instanceof UndeployedBraavosError) throw error;
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
    feeEstimateFailed: fee === null,
    requiresDeployment,
    totalFee,
  };
};
