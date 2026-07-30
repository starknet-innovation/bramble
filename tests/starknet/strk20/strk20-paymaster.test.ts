/**
 * Strict privacy-paymaster JSON-RPC contract tests. The plan shown to the user
 * must be the same fee action and typed data later submitted.
 */
import { describe, expect, test } from "bun:test";
import type { Call } from "starknet";
import {
  buildStrk20PaymasterPlan,
  submitStrk20PaymasterPlan,
} from "../../../src/starknet/strk20/paymaster";

const config = { feeToken: "0x3", url: "https://paymaster.example" };
const call: Call = {
  calldata: ["0x1"],
  contractAddress: "0x2",
  entrypoint: "apply_actions",
};

const response = (result: unknown): Response =>
  new Response(JSON.stringify({ id: "mc-wallet-strk20", jsonrpc: "2.0", result }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });

describe("STRK20 paymaster boundary", () => {
  test("freezes a validated fee plan and outside-execution typed data", async () => {
    const requests: Record<string, unknown>[] = [];
    const plan = await buildStrk20PaymasterPlan({
      accountAddress: "0x1",
      approveCalls: [call],
      config,
      http: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return response({
          fee_action: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" },
          typed_data: { domain: {}, message: {}, primaryType: "Outside", types: {} },
        });
      },
      poolAddress: "0x2",
    });
    expect(plan.feeAction).toEqual({
      amount: "0x5",
      recipient: "0x4",
      token: "0x3",
      type: "withdraw",
    });
    expect(plan.typedData).toBeDefined();
    expect(requests[0]?.["method"]).toBe("paymaster_buildTransaction");
  });

  test("rejects a fee action for a token other than the configured fee token", async () => {
    await expect(
      buildStrk20PaymasterPlan({
        accountAddress: "0x1",
        approveCalls: [],
        config,
        http: async () =>
          response({
            fee_action: { amount: "0x5", recipient: "0x4", token: "0x99", type: "withdraw" },
          }),
        poolAddress: "0x2",
      }),
    ).rejects.toThrow("strk20 private submission unavailable");
  });

  test("submits the frozen proof and validates the returned transaction hash", async () => {
    const requests: Record<string, unknown>[] = [];
    const result = await submitStrk20PaymasterPlan({
      accountAddress: "0x1",
      call,
      config,
      http: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return response({ transaction_hash: "0x123" });
      },
      plan: {
        feeAction: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" },
      },
      proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
      signTypedData: async () => {
        throw new Error("no public approval signature expected");
      },
    });
    expect(result).toEqual({ transactionHash: "0x123" });
    expect(requests[0]?.["method"]).toBe("paymaster_executeTransaction");
  });

  test("signs exactly the frozen typed data for public token approvals", async () => {
    const typedData = { domain: {}, message: { nonce: "0x1" }, primaryType: "Outside", types: {} };
    let signed: unknown;
    let submitted: Record<string, unknown> | undefined;
    await submitStrk20PaymasterPlan({
      accountAddress: "0x1",
      call,
      config,
      http: async (_url, init) => {
        submitted = JSON.parse(String(init?.body));
        return response({ transaction_hash: "0x123" });
      },
      plan: {
        feeAction: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" },
        typedData,
      },
      proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
      signTypedData: async (value) => {
        signed = value;
        return ["0x6", "0x7"];
      },
    });
    expect(signed).toBe(typedData);
    expect(submitted?.["params"]).toMatchObject({
      transaction: {
        invoke: { signature: ["0x6", "0x7"], typed_data: typedData, user_address: "0x1" },
        type: "invoke_and_apply_action",
      },
    });
  });

  test("rejects malformed JSON-RPC envelopes and transaction hashes", async () => {
    await expect(
      submitStrk20PaymasterPlan({
        accountAddress: "0x1",
        call,
        config,
        http: async () => response({ transaction_hash: "not-a-hash" }),
        plan: {
          feeAction: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" },
        },
        proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
        signTypedData: async () => [],
      }),
    ).rejects.toThrow("strk20 private submission unavailable");
  });

  test("rejects HTTP failures, invalid JSON, and JSON-RPC errors", async () => {
    const plan = {
      feeAction: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" },
    } as const;
    for (const http of [
      async () => new Response("unavailable", { status: 503 }),
      async () => new Response("not json", { status: 200 }),
      async () =>
        new Response(
          JSON.stringify({
            error: { code: -32_000, message: "failed" },
            id: "mc-wallet-strk20",
            jsonrpc: "2.0",
          }),
          { status: 200 },
        ),
    ]) {
      await expect(
        submitStrk20PaymasterPlan({
          accountAddress: "0x1",
          call,
          config,
          http,
          plan,
          proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
          signTypedData: async () => [],
        }),
      ).rejects.toThrow("strk20 private submission unavailable");
    }
  });
});
