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
import { postDeploymentFailure } from "@bramble/starknet/rpc-submit";
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

// mc-wallet 719: a swap from an undeployed account deploys it first. That
// accepted deployment is recorded beside the swap, and still recorded when the
// swap after it is refused or loses its reply, since its fee is spent.
describe("a swap that deploys the account first", () => {
  const DEPLOY = "0xd3a1";
  const kinds = (rows: readonly { readonly hash: string; readonly kind: string }[]) =>
    rows.map((row) => [row.kind, row.hash]);

  test("records the deployment beside the swap", async () => {
    const { response, rows } = await execute(async () => ({
      calls: [],
      deploymentTransactionHash: DEPLOY,
      transactionHash: SIGNED,
    }));
    expect(response).toEqual({ ok: true, transactionHash: SIGNED });
    expect(kinds(rows)).toContainEqual(["deploy", DEPLOY]);
    expect(kinds(rows)).toContainEqual(["invoke", SIGNED]);
  });

  test("still records the deployment when the swap after it is refused", async () => {
    const { response, rows } = await execute(async () => {
      throw postDeploymentFailure(DEPLOY, new Error("invoke rejected"));
    });
    expect(response).toMatchObject({ error: expect.any(String) });
    expect(kinds(rows)).toEqual([["deploy", DEPLOY]]);
  });

  test("still records the deployment when the swap's reply is lost, and stays unknown", async () => {
    const { response, rows } = await execute(async (input) => {
      await input.onSigned?.({ nonce: "0x1", senderAddress: "0x1", transactionHash: SIGNED });
      throw postDeploymentFailure(DEPLOY, new IndeterminateRpcWriteError("reply lost"));
    });
    expect(response).toMatchObject({ submissionUnknown: true, transactionHash: SIGNED });
    expect(kinds(rows)).toContainEqual(["deploy", DEPLOY]);
    expect(kinds(rows)).toContainEqual(["invoke", SIGNED]);
  });

  test("records no deployment when none was sent", async () => {
    const { rows } = await execute(async () => ({ calls: [], transactionHash: SIGNED }));
    expect(rows.some((row) => row.kind === "deploy")).toBe(false);
  });
});
