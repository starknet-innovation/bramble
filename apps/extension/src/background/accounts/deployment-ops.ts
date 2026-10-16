/** Explicit account-deployment fee review and submission. */

import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import type { FeeEstimate, StarkHashSigner } from "@bramble/starknet/rpc";
import type { ActivityLog } from "@bramble/transactions/activity";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
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

/** The Activity summary every account deployment is recorded under. */
export const DEPLOY_ACTIVITY_SUMMARY = "Deploy account contract";

/**
 * Records an account deployment in Activity: the explicit deploy, or the one a
 * send from an undeployed account ran first (mc-wallet 712). The hash is the
 * accepted DEPLOY_ACCOUNT; the reconciler settles its status as for any row.
 */
const recordAccountDeployment = (
  activity: ActivityLog,
  input: {
    readonly accountId: string;
    readonly hash: string;
    readonly networkId: StarknetNetworkId;
  },
): Promise<void> =>
  recordSubmittedActivity(activity, {
    accountId: input.accountId,
    hash: input.hash,
    kind: "deploy",
    networkId: input.networkId,
    summary: DEPLOY_ACTIVITY_SUMMARY,
  });

/**
 * Records the deployment a send from an undeployed account ran first, when
 * `hash` names one; resolves at once otherwise.
 */
export const recordAutoDeployment = (
  activity: ActivityLog,
  account: AccountRef,
  hash: string | undefined,
): Promise<void> =>
  hash === undefined
    ? Promise.resolve()
    : recordAccountDeployment(activity, {
        accountId: account.id,
        hash,
        networkId: account.networkId,
      });

// An account already deployed is refused by name before anything is estimated or
// signed: estimating a deployment for it fails, and that failure read as
// "Couldn't estimate the network fee", which is not why (mc-wallet 712). A
// failed status read is not a verdict, so the deploy path decides as before.
const alreadyDeployed = (
  deps: AccountDeploymentDeps,
  account: AccountRef,
  rpcUrls: readonly string[],
): Promise<boolean> =>
  deps.runtimeRpc
    .getDeploymentStatus({ accountAddress: account.address, rpcUrls })
    .then((deployed) => deployed === true)
    .catch(() => false);

/**
 * Reviews first, then submits only under the fee echoed by the confirmation.
 * An account the node already reports deployed is refused with
 * "account already deployed" before anything is estimated or signed.
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
  if (await alreadyDeployed(deps, input.account, rpcUrls)) {
    return { error: "account already deployed" };
  }
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
  await recordAccountDeployment(deps.activity, {
    accountId: input.account.id,
    hash: result.transactionHash,
    networkId: input.networkId,
  });
  return { ok: true, transactionHash: result.transactionHash };
};
