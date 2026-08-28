/**
 * Display-safe privacy-score state shared by the background and wallet UI.
 * Scores describe public withdrawal linkability estimates; they are never an
 * anonymity, safety, or compliance guarantee.
 */
import { hasOnlyKnownKeys, isRecord, isStringArray } from "@mc-wallet/core/json";

/**
 * Neutral presentation band derived from the signed 0..100 score.
 */
export type PrivacyScoreBand = "highly-linkable" | "moderate" | "stronger" | "weak";

/**
 * Returns the neutral band defined by the privacy-score integration contract.
 */
export const privacyScoreBand = (score: number): PrivacyScoreBand =>
  score < 25 ? "highly-linkable" : score < 50 ? "weak" : score < 75 ? "moderate" : "stronger";

/**
 * Locally attributed account summary. The headline is the lowest matched
 * withdrawal score, deliberately conservative when an account has several.
 */
export type AvailablePrivacyScore = {
  readonly band: PrivacyScoreBand;
  readonly candidateCount: number;
  readonly confidence: "high" | "low" | "medium";
  readonly effectiveAnonymitySet: number;
  readonly factors: readonly string[];
  readonly generatedAt: string;
  readonly matchedWithdrawals: number;
  readonly maximumScore: number;
  readonly medianScore: number;
  readonly minimumScore: number;
  readonly score: number;
  readonly snapshotBlockNumber: number;
  readonly status: "available";
};

/**
 * Privacy-score disclosure for the active STRK20 account.
 */
export type PrivacyScoreState =
  | AvailablePrivacyScore
  | {
      readonly status: "no-withdrawals" | "pending" | "stale" | "unavailable" | "unsupported";
    };

const isSafeNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isScore = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

/**
 * Validates privacy-score state crossing the background/UI message boundary.
 * Unknown fields and oversized factor text fail closed.
 */
export const isPrivacyScoreState = (value: unknown): value is PrivacyScoreState => {
  if (!isRecord(value) || typeof value["status"] !== "string") {
    return false;
  }
  if (value["status"] !== "available") {
    return (
      hasOnlyKnownKeys(value, ["status"]) &&
      (value["status"] === "no-withdrawals" ||
        value["status"] === "pending" ||
        value["status"] === "stale" ||
        value["status"] === "unavailable" ||
        value["status"] === "unsupported")
    );
  }
  if (
    !hasOnlyKnownKeys(value, [
      "band",
      "candidateCount",
      "confidence",
      "effectiveAnonymitySet",
      "factors",
      "generatedAt",
      "matchedWithdrawals",
      "maximumScore",
      "medianScore",
      "minimumScore",
      "score",
      "snapshotBlockNumber",
      "status",
    ]) ||
    !isScore(value["score"]) ||
    !isScore(value["minimumScore"]) ||
    !isScore(value["medianScore"]) ||
    !isScore(value["maximumScore"]) ||
    value["score"] !== value["minimumScore"] ||
    value["minimumScore"] > value["medianScore"] ||
    value["medianScore"] > value["maximumScore"] ||
    value["band"] !== privacyScoreBand(value["score"]) ||
    !isSafeNonNegative(value["candidateCount"]) ||
    typeof value["effectiveAnonymitySet"] !== "number" ||
    !Number.isFinite(value["effectiveAnonymitySet"]) ||
    value["effectiveAnonymitySet"] < 0 ||
    (value["confidence"] !== "low" &&
      value["confidence"] !== "medium" &&
      value["confidence"] !== "high") ||
    !isStringArray(value["factors"]) ||
    value["factors"].length > 16 ||
    value["factors"].some((factor) => factor.length === 0 || factor.length > 256) ||
    typeof value["generatedAt"] !== "string" ||
    value["generatedAt"].length > 64 ||
    Number.isNaN(Date.parse(value["generatedAt"])) ||
    !isSafeNonNegative(value["matchedWithdrawals"]) ||
    value["matchedWithdrawals"] === 0 ||
    !isSafeNonNegative(value["snapshotBlockNumber"])
  ) {
    return false;
  }
  return true;
};
