/** Strict readers for the signed privacy-score manifest and snapshot schema. */
import {
  hasOnlyKnownKeys,
  isBaseUnitsAmount,
  isRecord,
  isStringArray,
  normalizeJsonWithinBudget,
} from "@mc-wallet/core/json";
import { isStarkFieldElement } from "@mc-wallet/wallet-model/networks";

/**
 * Reviewed CloudFront distribution serving the same public artifact to every wallet.
 */
export const PRIVACY_SCORE_ORIGIN = "https://d2phvtlrdr7sx2.cloudfront.net";
/**
 * Pinned DER SPKI for the service's P-256 signing key. Rotation needs a wallet release.
 */
export const PRIVACY_SCORE_PUBLIC_KEY_DER_BASE64 =
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEbjNU73YXawLoqlBXlSo5c2cJa/qynedFoX1QAXefrG2SddtB1s8luzjZVkJEuCyBkugKHzZPxlx79lAxI2MTrQ==";
/**
 * SHA-256 of the exact pinned DER SPKI bytes above.
 */
export const PRIVACY_SCORE_PUBLIC_KEY_FINGERPRINT =
  "a8cc87fd17f35c5d8e799fd364557e285b09f27fc19ebfc1f9d4b5215f3b62eb";
/**
 * Key identifier required identically in the manifest and signed envelope.
 */
export const PRIVACY_SCORE_KEY_ID = `sha256:${PRIVACY_SCORE_PUBLIC_KEY_FINGERPRINT}`;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SNAPSHOT_KEY_PATTERN =
  /^v1\/snapshots\/[1-9][0-9]{0,15}-[0-9a-f]{16}-[0-9a-f]{16}\.json\.gz$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const EVENT_ID_PATTERN = /^(0x[0-9a-f]+):([0-9]{1,10})$/;

/**
 * Validated signature metadata shared by the manifest and signed artifact.
 */
export type SnapshotSignature = {
  readonly algorithm: "ECDSA_SHA_256";
  readonly keyId: string;
  readonly value: string;
};

/**
 * Validated mutable manifest.
 */
export type PrivacyScoreManifest = {
  readonly generatedAt: string;
  readonly payloadSha256: string;
  readonly signature: SnapshotSignature;
  readonly snapshotBlockHash: string;
  readonly snapshotBlockNumber: number;
  readonly snapshotKey: string;
};

/**
 * Validated score row consumed by local account attribution.
 */
export type WithdrawalScore = {
  readonly amount: string;
  readonly candidateCount: number;
  readonly confidence: "high" | "low" | "medium";
  readonly effectiveAnonymitySet: number;
  readonly eventId: string;
  readonly factors: readonly string[];
  readonly score: number;
  readonly token: string;
  readonly transactionHash: string;
};

/**
 * Validated wallet-facing slice of a verified signed payload.
 *
 * The large public-event and pool-metric arrays are deliberately absent: they
 * are covered by the signature but never retained by the extension worker.
 */
export type PrivacyScoreEnvelope = {
  readonly generatedAt: string;
  readonly payloadSha256: string;
  readonly signature: SnapshotSignature;
  readonly snapshotBlockHash: string;
  readonly snapshotBlockNumber: number;
  readonly withdrawals: readonly WithdrawalScore[];
};

/**
 * Checks an untrusted value for a non-negative safe integer.
 */
export const isPrivacyScoreSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * Checks the bounded ISO timestamp grammar used by score artifacts.
 */
export const isPrivacyScoreIsoDate = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 64 &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  !Number.isNaN(Date.parse(value));

/**
 * Checks the lowercase SHA-256 digest grammar used by score artifacts.
 */
export const isPrivacyScoreDigest = (value: unknown): value is string =>
  typeof value === "string" && SHA256_PATTERN.test(value);

/**
 * Reads signature metadata without accepting an unpinned key or algorithm.
 */
export const readPrivacyScoreSignature = (value: unknown): SnapshotSignature | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["algorithm", "keyId", "value"]) ||
    value["algorithm"] !== "ECDSA_SHA_256" ||
    value["keyId"] !== PRIVACY_SCORE_KEY_ID ||
    typeof value["value"] !== "string" ||
    value["value"].length > 256 ||
    !BASE64_PATTERN.test(value["value"])
  ) {
    return null;
  }
  return { algorithm: "ECDSA_SHA_256", keyId: value["keyId"], value: value["value"] };
};

/**
 * Reads the mutable manifest without trusting unknown keys or unsafe object shapes.
 */
export const readPrivacyScoreManifest = (input: unknown): PrivacyScoreManifest | null => {
  const value = normalizeJsonWithinBudget(input);
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, [
      "generatedAt",
      "payloadSha256",
      "schemaVersion",
      "signature",
      "snapshotBlockHash",
      "snapshotBlockNumber",
      "snapshotKey",
    ]) ||
    value["schemaVersion"] !== 1 ||
    !isPrivacyScoreIsoDate(value["generatedAt"]) ||
    !isPrivacyScoreDigest(value["payloadSha256"]) ||
    typeof value["snapshotBlockHash"] !== "string" ||
    !isStarkFieldElement(value["snapshotBlockHash"]) ||
    !isPrivacyScoreSafeInteger(value["snapshotBlockNumber"]) ||
    typeof value["snapshotKey"] !== "string" ||
    !SNAPSHOT_KEY_PATTERN.test(value["snapshotKey"])
  ) {
    return null;
  }
  const signature = readPrivacyScoreSignature(value["signature"]);
  return signature
    ? {
        generatedAt: value["generatedAt"],
        payloadSha256: value["payloadSha256"],
        signature,
        snapshotBlockHash: value["snapshotBlockHash"],
        snapshotBlockNumber: value["snapshotBlockNumber"],
        snapshotKey: value["snapshotKey"],
      }
    : null;
};

const hasExpectedFactors = (factors: readonly string[], candidateCount: number): boolean =>
  factors.length === 4 &&
  factors[0] === `${candidateCount} same-token deposits in the lookback window` &&
  (factors[1] === "exact public amount matches exist" ||
    factors[1] === "no exact public amount match") &&
  (factors[2] === "recipient address also appears as a depositor" ||
    factors[2] === "no recipient reuse observed") &&
  (factors[3] === "a candidate deposit is in the same transaction" ||
    factors[3] === "no same-transaction deposit observed");

/**
 * Reads one withdrawal score row from the verified payload slice.
 */
export const readWithdrawalScore = (value: unknown): WithdrawalScore | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, [
      "amount",
      "asOfBlock",
      "candidateCount",
      "confidence",
      "effectiveAnonymitySet",
      "eventId",
      "factors",
      "maxProbability",
      "score",
      "token",
      "transactionHash",
    ]) ||
    !isBaseUnitsAmount(value["amount"]) ||
    !isPrivacyScoreSafeInteger(value["asOfBlock"]) ||
    !isPrivacyScoreSafeInteger(value["candidateCount"]) ||
    (value["confidence"] !== "low" &&
      value["confidence"] !== "medium" &&
      value["confidence"] !== "high") ||
    typeof value["effectiveAnonymitySet"] !== "number" ||
    !Number.isFinite(value["effectiveAnonymitySet"]) ||
    value["effectiveAnonymitySet"] < 0 ||
    typeof value["eventId"] !== "string" ||
    !EVENT_ID_PATTERN.test(value["eventId"]) ||
    !isStringArray(value["factors"]) ||
    !hasExpectedFactors(value["factors"], value["candidateCount"]) ||
    typeof value["maxProbability"] !== "number" ||
    !Number.isFinite(value["maxProbability"]) ||
    value["maxProbability"] < 0 ||
    value["maxProbability"] > 1 ||
    typeof value["score"] !== "number" ||
    !Number.isFinite(value["score"]) ||
    value["score"] < 0 ||
    value["score"] > 100 ||
    typeof value["token"] !== "string" ||
    !isStarkFieldElement(value["token"]) ||
    typeof value["transactionHash"] !== "string" ||
    !isStarkFieldElement(value["transactionHash"])
  ) {
    return null;
  }
  const event = EVENT_ID_PATTERN.exec(value["eventId"]);
  if (!event || !isStarkFieldElement(event[1] ?? "")) {
    return null;
  }
  return {
    amount: value["amount"],
    candidateCount: value["candidateCount"],
    confidence: value["confidence"],
    effectiveAnonymitySet: value["effectiveAnonymitySet"],
    eventId: value["eventId"],
    factors: [...value["factors"]],
    score: value["score"],
    token: value["token"],
    transactionHash: value["transactionHash"],
  };
};

/**
 * Constant-shape equality for the manifest/envelope signature metadata.
 */
export const sameSnapshotSignature = (
  left: PrivacyScoreManifest["signature"],
  right: PrivacyScoreEnvelope["signature"],
): boolean =>
  left.algorithm === right.algorithm && left.keyId === right.keyId && left.value === right.value;
