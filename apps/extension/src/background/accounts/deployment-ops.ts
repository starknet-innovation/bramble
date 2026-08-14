/** Explicit account-deployment fee review and submission. */

import type { WalletPreferencesStore } from "@mc-wallet/settings/preferences";
import type { FeeEstimate, StarkHashSigner } from "@mc-wallet/starknet/rpc";
import type { ActivityLog } from "@mc-wallet/transactions/activity";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { StarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import { STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { recordSubmittedActivity } from "../transactions/activity-recording";
import { requiredFeeReview } from "../transactions/fee-review";

type AccountDeploymentDeps = {
  readonly activity: ActivityLog;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
};

/**
 * Reviews first, then submits only under the fee echoed by the confirmation.
 */
export const submitReviewedAccountDeployment = async (
  deps: AccountDeploymentDeps,
  input: {
    readonly account: AccountRef;
    readonly isAuthorized: () => boolean;
    readonly networkId: StarknetNetworkId;
    readonly reviewedFee?: FeeEstimate;
    readonly signHash: StarkHashSigner;
  },
): Promise<RuntimeResponse> => {
  const rpcUrls = networkRpcUrls(
    STARKNET_NETWORKS[input.networkId],
    await deps.preferencesStore.read(),
  );
  if (!input.reviewedFee) {
    return requiredFeeReview(() => {
      if (!deps.runtimeRpc.estimateAccountDeploymentFee) {
        return Promise.reject(new Error("deployment fee estimation unavailable"));
      }
      return deps.runtimeRpc.estimateAccountDeploymentFee({
        account: input.account,
        rpcUrls,
        signHash: input.signHash,
      });
    });
  }
  const result = await deps.runtimeRpc.submitAccountDeployment({
    account: input.account,
    isAuthorized: input.isAuthorized,
    reviewedFee: input.reviewedFee,
    rpcUrls,
    signHash: input.signHash,
  });
  await recordSubmittedActivity(deps.activity, {
    accountId: input.account.id,
    hash: result.transactionHash,
    kind: "deploy",
    networkId: input.networkId,
    summary: "Deploy account contract",
  });
  return { ok: true, transactionHash: result.transactionHash };
};
