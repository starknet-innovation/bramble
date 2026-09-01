/**
 * Pure popup validators for pre-sign transfer review responses.
 */

import { isErrorDetail } from "@mc-wallet/core/errors";
import { hasOnlyKnownKeys, isJson, isRecord, isRiskFlagCode } from "@mc-wallet/core/json";
import { type FeeEstimate, isFeeEstimate } from "@mc-wallet/starknet/fee-bounds";

/**
 * Pre-sign transfer review accepted from the background boundary.
 */
export type TransferReviewResponse = {
  readonly ok: true;
  readonly review: {
    readonly deploymentFee?: FeeEstimate | null;
    readonly deploymentFeeEstimateFailed?: boolean;
    readonly fee: FeeEstimate | null;
    /**
     * Fee-affordability verdict from the shared predicate (issue 191).
     * "unknown" means no claim was possible; surfaces warn only on
     * "insufficient" and never block on this field.
     */
    readonly feeAffordability: "insufficient" | "ok" | "unknown";
    /**
     * The node's own reason a fee estimate was rejected, only ever present with
     * `feeEstimateFailed`. Shown on the wallet's own review surface so a user
     * can read and copy why the estimate failed.
     */
    readonly feeEstimateDetail?: string;
    readonly feeEstimateFailed: boolean;
    readonly flags: readonly { readonly code: string; readonly message: string }[];
    readonly requiresDeployment: boolean;
    readonly summaries: readonly string[];
  };
};

/**
 * Network fee returned before a wallet-initiated operation may be confirmed.
 */
export type FeeReviewResponse = {
  readonly feeReview: FeeEstimate;
  readonly ok: true;
};

/**
 * Checks a wallet-initiated fee review before any extension page renders it.
 */
export const isFeeReviewResponse = (value: unknown): value is FeeReviewResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["feeReview", "ok"]) &&
  value["ok"] === true &&
  isFeeEstimate(value["feeReview"]);

const isRiskFlagShape = (value: unknown): value is { code: string; message: string } =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["code", "message"]) &&
  isRiskFlagCode(value["code"]) &&
  typeof value["message"] === "string" &&
  value["message"].length > 0 &&
  value["message"].length <= 300;

/**
 * Checks a fee estimate before any extension page renders it. Re-exported from
 * the one definition in `../starknet/fee-bounds` so the page and the background
 * cannot disagree about what a fee is.
 */
export const isFeeShape = isFeeEstimate;

/**
 * Checks transfer review responses before rendering the review step.
 */
export const isTransferReviewResponse = (value: unknown): value is TransferReviewResponse => {
  if (
    !isRecord(value) ||
    !isJson(value) ||
    !hasOnlyKnownKeys(value, ["ok", "review"]) ||
    value["ok"] !== true ||
    !isRecord(value["review"]) ||
    !hasOnlyKnownKeys(value["review"], [
      "fee",
      "deploymentFee",
      "deploymentFeeEstimateFailed",
      "feeAffordability",
      "feeEstimateDetail",
      "feeEstimateFailed",
      "flags",
      "requiresDeployment",
      "summaries",
    ])
  ) {
    return false;
  }
  const review = value["review"];
  const deploymentFee = review["deploymentFee"];
  const deploymentFailed = review["deploymentFeeEstimateFailed"];
  return (
    (deploymentFee === undefined || deploymentFee === null || isFeeShape(deploymentFee)) &&
    (deploymentFailed === undefined || typeof deploymentFailed === "boolean") &&
    (review["fee"] === null || isFeeShape(review["fee"])) &&
    (review["feeAffordability"] === "insufficient" ||
      review["feeAffordability"] === "ok" ||
      review["feeAffordability"] === "unknown") &&
    // An affordability claim requires an estimate to compare against.
    (review["fee"] !== null || review["feeAffordability"] === "unknown") &&
    typeof review["feeEstimateFailed"] === "boolean" &&
    // The node's reason is bounded by the producer's own shape check and only
    // travels with an actual failure, so a stray or oversized diagnostic never
    // reaches the review screen.
    (review["feeEstimateDetail"] === undefined ||
      (isErrorDetail(review["feeEstimateDetail"]) && review["feeEstimateFailed"] === true)) &&
    Array.isArray(review["flags"]) &&
    review["flags"].every(isRiskFlagShape) &&
    typeof review["requiresDeployment"] === "boolean" &&
    (review["requiresDeployment"] !== true ||
      (typeof deploymentFailed === "boolean" &&
        ((deploymentFailed && deploymentFee === null) ||
          (!deploymentFailed && isFeeShape(deploymentFee))))) &&
    Array.isArray(review["summaries"]) &&
    review["summaries"].every(
      (summary) => typeof summary === "string" && summary.length > 0 && summary.length <= 300,
    )
  );
};
