/**
 * A node refusal at estimation or submission is the node's sentence, for the
 * dapp and for the approval card. No calldata or gas cap is applied first.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import { networkRejectionMessage } from "@bramble/starknet/node-rejection";
import { invokeFailureResponse } from "../../../apps/extension/src/background/provider/provider-invoke-failure";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { estimateInvokeAndDeployment } from "../../../apps/extension/src/background/transactions/transfer-fee-review";

const CALLDATA = "Calldata length exceeded maximum: length 5001 (allowed length: 5000)";
const SENTENCE = networkRejectionMessage(CALLDATA);

const nodeError = () =>
  Object.assign(new Error(`RPC: starknet_addInvokeTransaction with params ${"{}".repeat(400)}`), {
    baseError: { code: 63, message: CALLDATA },
  });

describe("dapp invoke network rejection", () => {
  test("returns the node's submission sentence to the dapp", async () => {
    const response = await invokeFailureResponse(
      nodeError(),
      false,
      undefined,
      async () => undefined,
      async () => undefined,
    );
    expect(response).toEqual({ error: SENTENCE });
    expect(JSON.stringify(response)).not.toContain("with params");
  });

  test("leaves a wallet-written failure unchanged", async () => {
    const response = await invokeFailureResponse(
      new WalletError("invoke request failed"),
      false,
      undefined,
      async () => undefined,
      async () => undefined,
    );
    expect(response).toEqual({ error: "invoke request failed" });
  });

  test("keeps the node's sentence when estimation fails", async () => {
    const runtime = {
      async estimateInvokeFee() {
        throw nodeError();
      },
    } as unknown as RuntimeRpc;
    const priced = await estimateInvokeAndDeployment(runtime, {
      account: {} as never,
      calls: [{ calldata: [], contractAddress: "0x1", entrypoint: "transfer" }],
      deployed: true,
      rpcUrls: ["https://example.invalid"],
      signHash: (() => ["0x1", "0x2"]) as never,
    });
    expect(priced.fee).toBeNull();
    expect(priced.feeRejection).toBe(SENTENCE);
  });
});
