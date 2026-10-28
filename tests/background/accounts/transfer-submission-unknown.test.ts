/**
 * Audit #173: a public transfer whose broadcast reply was lost may already be
 * on chain. The background must say so with a typed refusal (never a plain
 * error the panel reads as "not sent") and keep the signed hash traceable as a
 * pending Activity row, so nothing invites a blind second payment.
 */
import { describe, expect, test } from "bun:test";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { readSubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import {
  account,
  extensionSender,
  makeHarness,
  reviewedFee,
  tokenId,
} from "../../support/wallet-activity-harness";

const SIGNED = "0x5eed";
const transfer = {
  accountId: account.id,
  amount: "1.5",
  recipient: "0x777",
  reviewedFee,
  speed: "standard",
  tokenId,
  type: "wallet.transfer",
};

describe("wallet.transfer with a lost broadcast reply", () => {
  test("returns a typed status-unknown refusal and records the signed hash as pending", async () => {
    const { activity, handler } = makeHarness({
      async submitTransfer(input) {
        await input.onSigned?.({
          nonce: "0x1",
          senderAddress: account.address,
          transactionHash: SIGNED,
        });
        throw new IndeterminateRpcWriteError("Transaction submission status is unknown.");
      },
    });
    const response = await handler(transfer, extensionSender);

    expect(response).toEqual({
      error: "Transaction submission status is unknown.",
      submissionUnknown: true,
      transactionHash: SIGNED,
    });
    expect(readSubmissionUnknownError(response)?.transactionHash).toBe(SIGNED);
    const rows = await activity.list();
    expect(rows.map((row) => [row.hash, row.status, row.kind])).toEqual([
      [SIGNED, "pending", "transfer"],
    ]);
  });

  test("stays status-unknown without a hash when nothing was signed for the invoke", async () => {
    const { activity, handler } = makeHarness({
      async submitTransfer() {
        throw new IndeterminateRpcWriteError("Account deployment status is unknown.");
      },
    });
    const response = await handler(transfer, extensionSender);

    expect(response).toEqual({
      error: "Account deployment status is unknown.",
      submissionUnknown: true,
    });
    expect(await activity.list()).toEqual([]);
  });

  test("keeps a determinate failure a plain error with no activity row", async () => {
    const { activity, handler } = makeHarness({
      async submitTransfer(input) {
        await input.onSigned?.({
          nonce: "0x1",
          senderAddress: account.address,
          transactionHash: SIGNED,
        });
        throw new Error("RPC refused the transaction");
      },
    });
    const response = await handler(transfer, extensionSender);

    expect(response).toEqual({ error: "RPC refused the transaction" });
    expect(await activity.list()).toEqual([]);
  });

  test("records the accepted hash on success, not the journaled one", async () => {
    const { activity, handler } = makeHarness({
      async submitTransfer(input) {
        expect(input.onSigned).toBeDefined();
        return { transactionHash: "0x7ab" };
      },
    });
    expect(await handler(transfer, extensionSender)).toEqual({
      ok: true,
      transactionHash: "0x7ab",
    });
    expect((await activity.list()).map((row) => row.hash)).toEqual(["0x7ab"]);
  });
});
