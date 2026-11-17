/**
 * Wire shapes of the phrase-driven recovery flows (Braavos 2FA removal, Ready
 * guardian escape) returned to extension pages. Split from runtime-types by
 * the size budget. None of these carries secret material: fees, timestamps,
 * step names and transaction hashes only.
 */
import type { FeeEstimate } from "@bramble/starknet/rpc";

/**
 * The recovery state a read-only verdict carries for the Home flag.
 * `pendingUntil` is when a running removal takes effect (Braavos) or can be
 * completed (Ready); `expiresAt` ends Ready's completion window (absent for Braavos).
 * `stage` is Ready-only: the escape's live status, `owner-escape` when a
 * guardian-approved key change is pending instead, `guardian-change` when an
 * escape to a NEW guardian is pending (never a removal), or `backup-guardian` /
 * `backup-unknown` when a backup guardian (or a failed read of it) makes the
 * phrase escape unavailable.
 */
export type AccountRecoveryState = {
  readonly delaySeconds: number;
  readonly expiresAt?: number;
  readonly pendingUntil: number | null;
  readonly stage?:
    | "backup-guardian"
    | "backup-unknown"
    | "expired"
    | "guardian-change"
    | "owner-escape"
    | "pending"
    | "ready";
};

/**
 * What a recovery confirmation states, for either vendor: the step, the
 * maximum fee the submission is held to, when the removal takes effect
 * (Braavos) or can be completed (Ready start; the escape's own time for a
 * completion), the end of Ready's completion window (null for Braavos), and
 * the pending escape starting would cancel (identified by its `readyAt`), if any.
 */
export type RecoveryReviewResponse = {
  readonly accountId: string;
  readonly expiresAt: number | null;
  readonly fee: FeeEstimate;
  readonly ok: true;
  readonly readyAt: number;
  readonly replaces: {
    readonly kind: "guardian-change" | "owner-escape";
    readonly readyAt: number;
  } | null;
  readonly step: "complete" | "start";
};

/** A submitted recovery step: its hash and when the removal takes effect, if known. */
export type RecoverAccountResponse = {
  readonly accountId: string;
  readonly ok: true;
  readonly pendingUntil: number | null;
  readonly transactionHash: string;
};
