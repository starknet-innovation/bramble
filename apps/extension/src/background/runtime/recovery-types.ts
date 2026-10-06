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
 * `stage` is Ready-only: the escape's live status, or `owner-escape` when a
 * guardian-approved key change is pending instead.
 */
export type AccountRecoveryState = {
  readonly delaySeconds: number;
  readonly expiresAt?: number;
  readonly pendingUntil: number | null;
  readonly stage?: "expired" | "owner-escape" | "pending" | "ready";
};

/**
 * What a recovery confirmation states, for either vendor: the step, the
 * maximum fee the submission is held to, when the removal takes effect
 * (Braavos) or can be completed (Ready start; the escape's own time for a
 * completion), the end of Ready's completion window (null for Braavos), and
 * whether starting cancels a pending owner escape.
 */
export type RecoveryReviewResponse = {
  readonly accountId: string;
  readonly expiresAt: number | null;
  readonly fee: FeeEstimate;
  readonly ok: true;
  readonly readyAt: number;
  readonly replacesOwnerEscape: boolean;
  readonly step: "complete" | "start";
};

/** A submitted recovery step: its hash and when the removal takes effect, if known. */
export type RecoverAccountResponse = {
  readonly accountId: string;
  readonly ok: true;
  readonly pendingUntil: number | null;
  readonly transactionHash: string;
};
