/** User-facing recovery copy for Argent multisig deployment failures. */
import type { ArgentMultisigDeploymentReview } from "../../../popup/responses/multisig-responses";
import { accountLabel } from "../../shared/parts";
import { formatFeeEstimate } from "../../shared/review-render";
import { FEE_FUNDING_SHORTFALL } from "../../shell/deploy-errors";

/**
 * Background error emitted when a one-time deployment review is stale.
 */
export const EXPIRED_DEPLOYMENT_REVIEW =
  "Argent multisig deployment must exactly match a fresh fee review";
/**
 * Concise recovery copy for a deterministic address already present on-chain.
 */
export const ALREADY_DEPLOYED_MESSAGE =
  "This multisig is already deployed. Open it from Multisigs instead of deploying it again.";

/**
 * Removes raw RPC detail from known deployment-review failures.
 */
export const deploymentReviewFailure = (raw: string): string =>
  /already deployed/i.test(raw) ? ALREADY_DEPLOYED_MESSAGE : raw;

/**
 * Converts deployment submission failures into actionable, copyable copy.
 */
export const deploymentFailureToast = (
  raw: string,
  review: ArgentMultisigDeploymentReview,
): string => {
  if (raw === EXPIRED_DEPLOYMENT_REVIEW) {
    return "The fee review expired. Review the deployment again before confirming.";
  }
  if (FEE_FUNDING_SHORTFALL.test(raw)) {
    return `Fund ${accountLabel(review.address)} with at least ${formatFeeEstimate(review.fee)}, then review the deployment again.`;
  }
  return raw;
};
