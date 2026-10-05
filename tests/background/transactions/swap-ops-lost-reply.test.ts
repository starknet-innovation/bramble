/**
 * A swap whose broadcast reply is lost may already be on chain (audit #173,
 * swap sibling). The background must say the outcome is unknown rather than
 * "failed", carry the signed hash so the panel can follow it, and file the
 * pending Activity row and the router approval for that hash — a grant that
 * may be live must never be missing from the allowance manager.
 */

import { describe, expect, test } from "bun:test";
import {
  INDETERMINATE_RPC_WRITE_MESSAGE,
  IndeterminateRpcWriteError,
} from "@bramble/starknet/provider";
import {
  approveRouter,
  buyTokenId,
  extensionSender,
  makeSwapHarness,
  QUOTE_ID,
  routeCall,
  type SwapSubmit,
  sellTokenId,
} from "../../support/swap-policy-harness";

const SIGNED = "0x5eed5aa9";

const lostAfterSigning: SwapSubmit = async (input) => {
  await input.onSigned?.({ nonce: "0x1", senderAddress: "0x1", transactionHash: SIGNED });
  throw new IndeterminateRpcWriteError(INDETERMINATE_RPC_WRITE_MESSAGE);
};

const lostBeforeSigning: SwapSubmit = async () => {
  throw new IndeterminateRpcWriteError(INDETERMINATE_RPC_WRITE_MESSAGE);
};

const execute = async (submit: SwapSubmit) => {
  const harness = makeSwapHarness([approveRouter, routeCall], submit);
  const prepared = await harness.handler(
    {
      amount: "0.01",
      buyAmount: "12.5",
      buyTokenId,
      quoteId: QUOTE_ID,
      sellTokenId,
      type: "wallet.swapPrepare",
    },
    extensionSender,
  );
  const preparationId = "swapPreparation" in prepared ? prepared.swapPreparation.id : "";
  const response = await harness.handler(
    { preparationId, type: "wallet.swapExecute" },
    extensionSender,
  );
  const allowances = await harness.handler({ type: "wallet.allowances" }, extensionSender);
  return {
    allowances: "allowances" in allowances ? allowances.allowances : [],
    response,
    rows: await harness.activity.list(),
    submitted: harness.submitted,
  };
};

describe("swap with a lost broadcast reply", () => {
  test("is status unknown with the signed hash, a pending row, and the approval filed", async () => {
    const { allowances, response, rows, submitted } = await execute(lostAfterSigning);
    expect(response).toEqual({
      error: INDETERMINATE_RPC_WRITE_MESSAGE,
      submissionUnknown: true,
      transactionHash: SIGNED,
    });
    expect(submitted).toHaveLength(1);
    expect(rows).toMatchObject([{ hash: SIGNED, kind: "invoke", status: "pending" }]);
    expect(allowances).toMatchObject([{ amount: "10000000000000000", source: "wallet" }]);
  });

  test("is status unknown without a hash when none was signed", async () => {
    const { response, rows } = await execute(lostBeforeSigning);
    expect(response).toEqual({ error: INDETERMINATE_RPC_WRITE_MESSAGE, submissionUnknown: true });
    expect(rows).toEqual([]);
  });

  test("a determinate failure stays a plain error", async () => {
    const { response, rows } = await execute(async () => {
      throw new Error("fee exceeds the reviewed ceiling");
    });
    expect(response).toEqual({ error: "fee exceeds the reviewed ceiling" });
    expect(rows).toEqual([]);
  });
});
