/**
 * Recovery runtime client and reply validators: a submit sends back exactly
 * what the confirmation showed (account, fee, step, owner-escape
 * acknowledgement only when warned), and malformed or unknown-outcome replies
 * are rejected rather than half-trusted.
 */
import { describe, expect, test } from "bun:test";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import {
  isRecoverAccountResponse,
  isRecoveryReview,
  isRecoveryState,
  type RecoveryReview,
} from "../../../src/popup/responses/responses-recovery";
import { createRecoveryRuntimeClient } from "../../../src/sidepanel/runtime/runtime-recovery";

const REVIEW: RecoveryReview = {
  accountId: "SN_MAIN:0xa4e",
  expiresAt: 2_000,
  fee: { overallFee: "100", unit: "FRI" },
  ok: true,
  readyAt: 1_000,
  replaces: { kind: "owner-escape" as const, readyAt: 1_500 },
  step: "start",
};
const SUBMITTED = {
  accountId: "SN_MAIN:0xa4e",
  ok: true as const,
  pendingUntil: 1_000,
  transactionHash: "0x5",
};

const clientReplying = (reply: unknown) => {
  const sent: unknown[] = [];
  const client = createRecoveryRuntimeClient(async (message) => {
    sent.push(message);
    return reply;
  });
  return { client, sent };
};

describe("recovery runtime client", () => {
  test("reviews return validated confirmations", async () => {
    for (const method of ["reviewArgentRecovery", "reviewBraavosRecovery"] as const) {
      const { client, sent } = clientReplying(REVIEW);
      expect(await client[method]()).toEqual(REVIEW);
      expect(sent).toEqual([
        {
          type:
            method === "reviewArgentRecovery"
              ? "wallet.reviewArgentRecovery"
              : "wallet.reviewBraavosRecovery",
        },
      ]);
      await expect(clientReplying({ error: "nope" }).client[method]()).rejects.toThrow("nope");
    }
  });

  test("a malformed reply falls back to this flow's own diagnostics", async () => {
    for (const method of ["reviewArgentRecovery", "reviewBraavosRecovery"] as const) {
      await expect(clientReplying({ ok: true }).client[method]()).rejects.toThrow(
        "second factor removal unavailable",
      );
    }
    for (const method of ["recoverArgentAccount", "recoverBraavosAccount"] as const) {
      await expect(clientReplying({ ok: true }).client[method](REVIEW)).rejects.toThrow(
        "second factor removal unconfirmed",
      );
    }
  });

  test("a Braavos submit sends the reviewed account and fee only", async () => {
    const { client, sent } = clientReplying(SUBMITTED);
    expect(await client.recoverBraavosAccount(REVIEW)).toEqual(SUBMITTED);
    expect(sent).toEqual([
      {
        accountId: REVIEW.accountId,
        reviewedFee: REVIEW.fee,
        type: "wallet.recoverBraavosAccount",
      },
    ]);
  });

  test("a Ready submit sends the step, and the acknowledgement only when warned", async () => {
    const warned = clientReplying(SUBMITTED);
    await warned.client.recoverArgentAccount(REVIEW);
    expect(warned.sent).toEqual([
      {
        accountId: REVIEW.accountId,
        replaceEscape: { kind: "owner-escape", readyAt: 1_500 },
        reviewedFee: REVIEW.fee,
        step: "start",
        type: "wallet.recoverArgentAccount",
      },
    ]);
    const change = clientReplying(SUBMITTED);
    await change.client.recoverArgentAccount({
      ...REVIEW,
      replaces: { kind: "guardian-change", readyAt: 1_600 },
    });
    expect(change.sent).toMatchObject([
      { replaceEscape: { kind: "guardian-change", readyAt: 1_600 } },
    ]);
    const plain = clientReplying(SUBMITTED);
    await plain.client.recoverArgentAccount({ ...REVIEW, replaces: null });
    await plain.client.recoverArgentAccount({ ...REVIEW, step: "complete" });
    expect(plain.sent).toEqual([
      {
        accountId: REVIEW.accountId,
        reviewedFee: REVIEW.fee,
        step: "start",
        type: "wallet.recoverArgentAccount",
      },
      {
        accountId: REVIEW.accountId,
        reviewedFee: REVIEW.fee,
        step: "complete",
        type: "wallet.recoverArgentAccount",
      },
    ]);
  });

  test("an unknown outcome rejects as SubmissionUnknownError, never as success", async () => {
    for (const method of ["recoverArgentAccount", "recoverBraavosAccount"] as const) {
      const { client } = clientReplying({
        error: "Transaction submission status is unknown.",
        submissionUnknown: true,
        transactionHash: "0x5",
      });
      const error = await client[method](REVIEW).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SubmissionUnknownError);
      expect((error as SubmissionUnknownError).transactionHash).toBe("0x5");
    }
  });
});

describe("recovery reply validators", () => {
  test("accept only the exact confirmation shape", () => {
    expect(isRecoveryReview(REVIEW)).toBe(true);
    expect(isRecoveryReview({ ...REVIEW, step: "cancel" })).toBe(false);
    expect(isRecoveryReview({ ...REVIEW, readyAt: -1 })).toBe(false);
    expect(isRecoveryReview({ ...REVIEW, replaces: true })).toBe(false);
    expect(isRecoveryReview({ ...REVIEW, replaces: { kind: "owner-escape", readyAt: -1 } })).toBe(
      false,
    );
    expect(isRecoveryReview({ ...REVIEW, replaces: { kind: "other", readyAt: 1 } })).toBe(false);
    expect(isRecoveryReview({ ...REVIEW, replaces: { kind: "guardian-change", readyAt: 1 } })).toBe(
      true,
    );
    expect(isRecoveryReview({ ...REVIEW, delaySeconds: 1 })).toBe(false);
    expect(isRecoveryReview({ ...REVIEW, fee: { overallFee: "1", unit: "BTC" } })).toBe(false);
    expect(isRecoveryReview({ ...REVIEW, expiresAt: null })).toBe(true);
  });

  test("accept the recovery state stages and nothing else", () => {
    expect(isRecoveryState({ delaySeconds: 1, pendingUntil: null })).toBe(true);
    for (const stage of [
      "guardian-change",
      "backup-guardian",
      "backup-unknown",
      "expired",
      "owner-escape",
      "pending",
      "ready",
    ]) {
      expect(isRecoveryState({ delaySeconds: 1, expiresAt: 3, pendingUntil: 2, stage })).toBe(true);
    }
    expect(isRecoveryState({ delaySeconds: 1, pendingUntil: 2, stage: "cancelled" })).toBe(false);
    expect(isRecoveryState({ delaySeconds: 1, expiresAt: "3", pendingUntil: 2 })).toBe(false);
  });

  test("accept only a well-formed submit reply", () => {
    expect(isRecoverAccountResponse(SUBMITTED)).toBe(true);
    expect(isRecoverAccountResponse({ ...SUBMITTED, pendingUntil: null })).toBe(true);
    expect(isRecoverAccountResponse({ ...SUBMITTED, transactionHash: 5 })).toBe(false);
    expect(isRecoverAccountResponse({ ...SUBMITTED, extra: true })).toBe(false);
  });
});
