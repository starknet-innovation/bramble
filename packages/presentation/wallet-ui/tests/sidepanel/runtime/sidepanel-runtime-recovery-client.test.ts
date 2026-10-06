/**
 * The recovery runtime client sends exactly its message types and rejects a
 * malformed or error reply instead of returning a half-formed result.
 */
import { describe, expect, test } from "bun:test";
import { createRecoveryRuntimeClient } from "../../../src/sidepanel/runtime/runtime-recovery";

const fee = { overallFee: "1000", unit: "FRI" } as const;
const review = { accountId: "SN_MAIN:0x1", delaySeconds: 345_600, fee, ok: true } as const;
const submitted = {
  accountId: "SN_MAIN:0x1",
  ok: true,
  pendingUntil: 9,
  transactionHash: "0xab",
} as const;

const clientAnswering = (reply: unknown) => {
  const sent: unknown[] = [];
  const client = createRecoveryRuntimeClient(async (message) => {
    sent.push(message);
    return reply;
  });
  return { client, sent };
};

describe("recovery runtime client", () => {
  test("reviews and submits both vendors' recovery with their own message types", async () => {
    const reviewing = clientAnswering(review);
    await expect(reviewing.client.reviewBraavosRecovery()).resolves.toEqual(review);
    await expect(reviewing.client.reviewArgentRecovery()).resolves.toEqual(review);
    const submitting = clientAnswering(submitted);
    await expect(submitting.client.recoverBraavosAccount(fee)).resolves.toEqual(submitted);
    await expect(submitting.client.recoverArgentAccount(fee)).resolves.toEqual(submitted);
    expect([...reviewing.sent, ...submitting.sent]).toEqual([
      { type: "wallet.reviewBraavosRecovery" },
      { type: "wallet.reviewArgentRecovery" },
      { reviewedFee: fee, type: "wallet.recoverBraavosAccount" },
      { reviewedFee: fee, type: "wallet.recoverArgentAccount" },
    ]);
  });

  test("rejects a malformed reply with the fallback and an error reply with its reason", async () => {
    const { client } = clientAnswering({ ok: true });
    await expect(client.reviewBraavosRecovery()).rejects.toThrow("account recovery unavailable");
    await expect(client.reviewArgentRecovery()).rejects.toThrow("account recovery unavailable");
    await expect(client.recoverBraavosAccount(fee)).rejects.toThrow("account recovery failed");
    await expect(client.recoverArgentAccount(fee)).rejects.toThrow("account recovery failed");
    const refused = clientAnswering({ error: "This account has no 2FA signer to remove" });
    await expect(refused.client.recoverBraavosAccount(fee)).rejects.toThrow("no 2FA signer");
  });
});
