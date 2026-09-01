/** Fee-echo validation performed before an approval is consumed. */

import { type FeeEstimate, sameFeeEstimate, sumFeeEstimates } from "@bramble/starknet/fee-bounds";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { FEE_REVIEW_REQUIRED } from "../transactions/fee-review";
import type { PendingApproval } from "./approvals";

const pendingDeclareFeeRefusal = (
  pending: PendingApproval,
  reviewedFee: FeeEstimate | undefined,
): RuntimeResponse | null => {
  const declaration = pending.declaration;
  const declarationFee = declaration?.fee;
  const deploymentFee = declaration?.deploymentFee;
  if (
    !declarationFee ||
    declaration.feeEstimateFailed ||
    !reviewedFee ||
    declaration.accountDeployment === "unknown" ||
    (declaration.accountDeployment === "undeployed" &&
      (!deploymentFee || declaration.deploymentFeeEstimateFailed))
  ) {
    return FEE_REVIEW_REQUIRED;
  }
  const total = deploymentFee ? sumFeeEstimates(declarationFee, deploymentFee) : declarationFee;
  if (!total) return FEE_REVIEW_REQUIRED;
  return sameFeeEstimate(reviewedFee, total)
    ? null
    : { error: "the fee changed since this request was reviewed" };
};

/**
 * Refuses a fee-bearing decision whose displayed fee is absent, stale, or
 * incomplete. Null means the queue entry remains exactly fee-bound.
 */
export const pendingFeeRefusal = (
  pending: PendingApproval | null,
  reviewedFee: FeeEstimate | undefined,
): RuntimeResponse | null => {
  if (pending?.kind === "declare") return pendingDeclareFeeRefusal(pending, reviewedFee);
  if (pending?.kind !== "invoke") return null;
  if (
    !reviewedFee ||
    !pending.fee ||
    pending.feeEstimateFailed === true ||
    pending.feeEstimatePending === true
  ) {
    return FEE_REVIEW_REQUIRED;
  }
  return sameFeeEstimate(reviewedFee, pending.fee)
    ? null
    : { error: "the fee changed since this request was reviewed" };
};
