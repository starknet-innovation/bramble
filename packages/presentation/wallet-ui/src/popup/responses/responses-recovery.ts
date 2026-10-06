/**
 * Pure validators for the phrase-driven recovery flows (Braavos 2FA removal,
 * Ready guardian escape): the Home flag's recovery state, the confirmation
 * review, and the submit reply. Background replies are untrusted until these
 * vouch for them; every field a confirmation states is checked here.
 */
import { hasOnlyKnownKeys, isJson, isRecord } from "@bramble/core/json";
import { type FeeEstimate, isFeeEstimate } from "@bramble/starknet/fee-bounds";

const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * A recoverable read-only account's on-chain recovery state for the Home flag.
 * `pendingUntil` is when a running removal takes effect (Braavos) or can be
 * completed (Ready); `expiresAt` closes Ready's completion window; `stage` is
 * Ready-only: the escape's status, `owner-escape` when a guardian-approved key
 * change is pending, or `backup-guardian` / `backup-unknown` when a backup
 * guardian (or a failed read of it) makes the phrase escape unavailable.
 */
export type RecoveryState = {
  readonly delaySeconds: number;
  readonly expiresAt?: number;
  readonly pendingUntil: number | null;
  readonly stage?:
    | "backup-guardian"
    | "backup-unknown"
    | "expired"
    | "owner-escape"
    | "pending"
    | "ready";
};

const RECOVERY_STAGES: readonly unknown[] = [
  "backup-guardian",
  "backup-unknown",
  "expired",
  "owner-escape",
  "pending",
  "ready",
];

/** Validates the recovery state a signability verdict carries. */
export const isRecoveryState = (value: unknown): value is RecoveryState =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["delaySeconds", "expiresAt", "pendingUntil", "stage"]) &&
  isTime(value["delaySeconds"]) &&
  (value["expiresAt"] === undefined || isTime(value["expiresAt"])) &&
  (value["pendingUntil"] === null || isTime(value["pendingUntil"])) &&
  (value["stage"] === undefined || RECOVERY_STAGES.includes(value["stage"]));

/**
 * What a recovery confirmation states: the step, the maximum fee the submit is
 * held to, when the removal takes effect (Braavos) or can be completed (Ready),
 * the end of Ready's completion window (null for Braavos), and whether
 * starting cancels a pending owner escape. The account id binds the submit.
 */
export type RecoveryReview = {
  readonly accountId: string;
  readonly expiresAt: number | null;
  readonly fee: FeeEstimate;
  readonly ok: true;
  readonly readyAt: number;
  readonly replacesOwnerEscape: boolean;
  readonly step: "complete" | "start";
};

/** Validates a recovery review before its confirmation renders. */
export const isRecoveryReview = (value: unknown): value is RecoveryReview =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, [
    "accountId",
    "expiresAt",
    "fee",
    "ok",
    "readyAt",
    "replacesOwnerEscape",
    "step",
  ]) &&
  value["ok"] === true &&
  typeof value["accountId"] === "string" &&
  (value["expiresAt"] === null || isTime(value["expiresAt"])) &&
  isFeeEstimate(value["fee"]) &&
  isTime(value["readyAt"]) &&
  typeof value["replacesOwnerEscape"] === "boolean" &&
  (value["step"] === "start" || value["step"] === "complete");

/** A submitted recovery step: its hash and when the removal takes effect. */
export type RecoverAccountResponse = {
  readonly accountId: string;
  readonly ok: true;
  readonly pendingUntil: number | null;
  readonly transactionHash: string;
};

/** Validates the recovery submission reply. */
export const isRecoverAccountResponse = (value: unknown): value is RecoverAccountResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["accountId", "ok", "pendingUntil", "transactionHash"]) &&
  value["ok"] === true &&
  typeof value["accountId"] === "string" &&
  (value["pendingUntil"] === null || isTime(value["pendingUntil"])) &&
  typeof value["transactionHash"] === "string";
