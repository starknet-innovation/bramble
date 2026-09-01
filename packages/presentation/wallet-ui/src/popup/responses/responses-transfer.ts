/**
 * Pure popup validators for pre-sign transfer review responses.
 */

import { isErrorDetail } from "@mc-wallet/core/errors";
import { hasOnlyKnownKeys, isJson, isRecord } from "@mc-wallet/core/json";

/**
 * Pre-sign transfer review accepted from the background boundary.
 */
export type TransferReviewResponse = {
  readonly ok: true;
  readonly review: {
    readonly fee: { readonly overallFee: string; readonly unit: string } | null;
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

const isRiskFlagShape = (value: unknown): value is { code: string; message: string } =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["code", "message"]) &&
  typeof value["code"] === "string" &&
  /^[a-z][a-z-]{1,40}$/.test(value["code"]) &&
  typeof value["message"] === "string" &&
  value["message"].length > 0 &&
  value["message"].length <= 300;

/**
 * Checks a fee estimate before any extension page renders it.
 */
export const isFeeShape = (value: unknown): value is { overallFee: string; unit: string } =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["overallFee", "unit"]) &&
  typeof value["overallFee"] === "string" &&
  /^(?:0|[1-9][0-9]*)$/.test(value["overallFee"]) &&
  typeof value["unit"] === "string" &&
  /^[A-Z]{2,10}$/.test(value["unit"]);

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
  return (
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
    Array.isArray(review["summaries"]) &&
    review["summaries"].every(
      (summary) => typeof summary === "string" && summary.length > 0 && summary.length <= 300,
    )
  );
};
