/** User-facing recovery copy for Argent multisig deployment failures. */
import { t } from "../../../i18n/messages";
import type { ArgentMultisigDeploymentReview } from "../../../popup/responses/multisig-responses";
import { accountLabel } from "../../shared/parts";
import { FEE_FUNDING_SHORTFALL } from "../../shell/deploy-errors";
import { deploymentFundingMinimumText } from "./multisig-deploy-view";

/**
 * Background error emitted when a one-time deployment review is stale.
 */
export const EXPIRED_DEPLOYMENT_REVIEW =
  "Argent multisig deployment must exactly match a fresh fee review";
/**
 * Concise recovery copy for a deterministic address already present on-chain.
 */
export const alreadyDeployedMessage = (): string => t("multisig.deploy.alreadyDeployed");

/**
 * Removes raw RPC detail from known deployment-review failures.
 */
export const deploymentReviewFailure = (raw: string): string =>
  /already deployed/i.test(raw) ? alreadyDeployedMessage() : raw;

/**
 * Converts deployment submission failures into actionable, copyable copy.
 */
export const deploymentFailureToast = (
  raw: string,
  review: ArgentMultisigDeploymentReview,
): string => {
  if (raw === EXPIRED_DEPLOYMENT_REVIEW) {
    return t("multisig.deploy.feeReviewExpired");
  }
  if (FEE_FUNDING_SHORTFALL.test(raw)) {
    return t("multisig.deploy.fundAtLeast", {
      address: accountLabel(review.address),
      minimum: deploymentFundingMinimumText(review),
    });
  }
  return raw;
};
