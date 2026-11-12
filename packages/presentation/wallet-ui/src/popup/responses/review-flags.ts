/**
 * The one validator for risk flags and review-sentence references the panel
 * reads from the background (approvals, transfer, NFT and swap reviews).
 *
 * Trust boundary: the background is privileged but its replies still cross an
 * extension message; anything unexpected fails closed and drops the review.
 */
import { hasOnlyKnownKeys, isRecord, isRiskFlagCode } from "@bramble/core/json";
import { isReviewText, type ReviewText } from "@bramble/transactions/review-messages";

/** The longest risk-flag or summary line the panel renders. */
const REVIEW_LINE_MAX_LENGTH = 300;

/** A risk flag as the panel receives it. */
export type ReviewedRiskFlag = {
  readonly code: string;
  readonly message: string;
  readonly text?: ReviewText;
};

/** Whether a value is a renderable risk flag: a known code, bounded English, optional reference. */
export const isReviewedRiskFlag = (value: unknown): value is ReviewedRiskFlag =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["code", "message", "text"]) &&
  isRiskFlagCode(value["code"]) &&
  typeof value["message"] === "string" &&
  value["message"].length > 0 &&
  value["message"].length <= REVIEW_LINE_MAX_LENGTH &&
  (value["text"] === undefined || isReviewText(value["text"]));

/**
 * Whether `value` is absent or one review reference per English summary line.
 * A count mismatch fails closed: a reference must never describe another line.
 */
export const isOptionalSummaryTexts = (value: unknown, lines: number): boolean =>
  value === undefined ||
  (Array.isArray(value) && value.length === lines && value.every(isReviewText));
