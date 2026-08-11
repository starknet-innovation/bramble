/**
 * Pure popup validators for pre-sign transfer review responses.
 */

import { hasOnlyKnownKeys, isJson, isRecord, isRiskFlagCode } from "../shared/json";
import { type FeeEstimate, isFeeEstimate } from "../starknet/fee-bounds";

/**
 * Pre-sign transfer review accepted from the background boundary.
 */
export type TransferReviewResponse = {
  readonly ok: true;
  readonly review: {
    readonly fee: FeeEstimate | null;
    /**
     * Fee-affordability verdict from the shared predicate (issue 191).
     * "unknown" means no claim was possible; surfaces warn only on
     * "insufficient" and never block on this field.
     */
    readonly feeAffordability: "insufficient" | "ok" | "unknown";
    readonly feeEstimateFailed: boolean;
    readonly flags: readonly { readonly code: string; readonly message: string }[];
    readonly requiresDeployment: boolean;
    readonly summaries: readonly string[];
  };
};

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
      "feeAffordability",
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
    Array.isArray(review["flags"]) &&
    review["flags"].every(isRiskFlagShape) &&
    typeof review["requiresDeployment"] === "boolean" &&
    Array.isArray(review["summaries"]) &&
    review["summaries"].every(
      (summary) => typeof summary === "string" && summary.length > 0 && summary.length <= 300,
    )
  );
};
