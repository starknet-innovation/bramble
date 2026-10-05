/**
 * Pure popup validators for pre-sign transfer review responses.
 */

import { hasOnlyKnownKeys, isJson, isRecord, isRiskFlagCode } from "@bramble/core/json";
import { type FeeEstimate, isFeeEstimate } from "@bramble/starknet/fee-bounds";

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
    readonly feeEstimateFailed: boolean;
    readonly flags: readonly { readonly code: string; readonly message: string }[];
    readonly requiresDeployment: boolean;
    /** True when a device will be asked to sign both the deployment and the send. */
    readonly signsTwice?: boolean;
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
      "feeEstimateFailed",
      "flags",
      "requiresDeployment",
      "signsTwice",
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
    (review["signsTwice"] === undefined || typeof review["signsTwice"] === "boolean") &&
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

/**
 * Braavos recovery review (phrase-driven 2FA removal): the fee the request will
 * cost and the delay after which it takes effect (null when unavailable).
 */
export type ReviewBraavosRecoveryResponse = {
  readonly accountId: string;
  readonly delaySeconds: number | null;
  readonly fee: FeeEstimate;
  readonly ok: true;
};

/** Validates the recovery review before its card renders. */
export const isReviewBraavosRecoveryResponse = (
  value: unknown,
): value is ReviewBraavosRecoveryResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["accountId", "delaySeconds", "fee", "ok"]) &&
  value["ok"] === true &&
  typeof value["accountId"] === "string" &&
  (value["delaySeconds"] === null || typeof value["delaySeconds"] === "number") &&
  isFeeEstimate(value["fee"]);

/** Braavos recovery submission: the request hash and when it takes effect. */
export type RecoverBraavosAccountResponse = {
  readonly accountId: string;
  readonly ok: true;
  readonly pendingUntil: number | null;
  readonly transactionHash: string;
};

/** Validates the recovery submission reply. */
export const isRecoverBraavosAccountResponse = (
  value: unknown,
): value is RecoverBraavosAccountResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["accountId", "ok", "pendingUntil", "transactionHash"]) &&
  value["ok"] === true &&
  typeof value["accountId"] === "string" &&
  (value["pendingUntil"] === null || typeof value["pendingUntil"] === "number") &&
  typeof value["transactionHash"] === "string";
