/** Fee-echo validation performed before an approval is consumed. */

import type { GaslessFeeOffer } from "@bramble/privacy/gasless-request";
import { type FeeEstimate, sameFeeEstimate, sumFeeEstimates } from "@bramble/starknet/fee-bounds";
import { UNDEPLOYED_BRAAVOS_REFUSAL } from "@bramble/wallet-model/account-families";
import { sameFelt } from "@bramble/wallet-model/networks";
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
 * Refuses a gasless choice that is not one of the offers on the card. Null
 * means that offer is still the one the queue holds.
 */
export const pendingGaslessRefusal = (
  pending: PendingApproval | null,
  choice: GaslessFeeOffer,
): RuntimeResponse | null => {
  if (pending?.deployFirst === true) {
    return { error: UNDEPLOYED_BRAAVOS_REFUSAL };
  }
  if (pending?.kind !== "invoke") {
    return FEE_REVIEW_REQUIRED;
  }
  const match = pending.gaslessFees?.some(
    (offer) =>
      offer.amount === choice.amount &&
      offer.decimals === choice.decimals &&
      offer.label === choice.label &&
      sameFelt(offer.tokenAddress, choice.tokenAddress),
  );
  return match === true ? null : { error: "the fee changed since this request was reviewed" };
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
  // No fee can bind it: the account deploys only through its own step.
  if (pending.deployFirst === true) return { error: UNDEPLOYED_BRAAVOS_REFUSAL };
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
