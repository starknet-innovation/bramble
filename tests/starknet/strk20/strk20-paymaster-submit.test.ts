/** Submission-side privacy-paymaster contract tests. */
import { describe, expect, test } from "bun:test";
import { submitStrk20PaymasterPlan } from "../../../src/starknet/strk20/paymaster";
import { STRK20_SUBMISSION_UNAVAILABLE } from "../../../src/starknet/strk20/service";
import {
  paymasterCall as call,
  paymasterConfig as config,
  paymasterTypedData as outsideTypedData,
  paymasterResponse as response,
} from "../../support/strk20-paymaster";

describe("STRK20 paymaster submission boundary", () => {
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
      nowSeconds: 2,
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
    const typedData = outsideTypedData();
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
      nowSeconds: 2,
      plan: {
        authorization: {
          caller: "0x99",
          executeAfter: "0x1",
          executeBefore: "0x100",
          publicCallCount: 1,
        },
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

  test("rejects incomplete public authorization plans before signing or submitting", async () => {
    const authorization = {
      caller: "0x99",
      executeAfter: "0x1",
      executeBefore: "0x100",
      publicCallCount: 1,
    } as const;
    for (const plan of [
      {
        authorization,
        feeAction: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" as const },
      },
      {
        feeAction: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" as const },
        typedData: outsideTypedData(),
      },
    ]) {
      let signed = false;
      let submitted = false;
      await expect(
        submitStrk20PaymasterPlan({
          accountAddress: "0x1",
          call,
          config,
          http: async () => {
            submitted = true;
            return response({ transaction_hash: "0x123" });
          },
          nowSeconds: 2,
          plan,
          proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
          signTypedData: async () => {
            signed = true;
            return ["0x6", "0x7"];
          },
        }),
      ).rejects.toThrow("strk20 private submission unavailable");
      expect(signed).toBe(false);
      expect(submitted).toBe(false);
    }
  });

  test("rejects a plan that expires after quote without signing or submitting", async () => {
    let signed = false;
    let submitted = false;
    await expect(
      submitStrk20PaymasterPlan({
        accountAddress: "0x1",
        call,
        config,
        http: async () => {
          submitted = true;
          return response({ transaction_hash: "0x123" });
        },
        nowSeconds: 250,
        plan: {
          authorization: {
            caller: "0x99",
            executeAfter: "0x1",
            executeBefore: "0x100",
            publicCallCount: 1,
          },
          feeAction: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" },
          typedData: outsideTypedData(),
        },
        proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
        signTypedData: async () => {
          signed = true;
          return ["0x6", "0x7"];
        },
      }),
    ).rejects.toThrow("strk20 private submission unavailable");
    expect(signed).toBe(false);
    expect(submitted).toBe(false);
  });

  test("rejects malformed JSON-RPC envelopes and transaction hashes", async () => {
    await expect(
      submitStrk20PaymasterPlan({
        accountAddress: "0x1",
        call,
        config,
        http: async () => response({ transaction_hash: "not-a-hash" }),
        nowSeconds: 2,
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
        new Response("{}", {
          headers: { "content-length": String(1024 * 1024 + 1) },
          status: 200,
        }),
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
          nowSeconds: 2,
          plan,
          proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
          signTypedData: async () => [],
        }),
      ).rejects.toThrow("strk20 private submission unavailable");
    }
  });

  test("never exposes proof material echoed by the relay", async () => {
    const rejected = await submitStrk20PaymasterPlan({
      accountAddress: "0x1",
      call,
      config,
      http: async () =>
        new Response(
          JSON.stringify({
            error: {
              code: -32_000,
              data: { execution_error: "proof proof_facts 0x2" },
              message: "rejected proof",
            },
            id: "mc-wallet-strk20",
            jsonrpc: "2.0",
          }),
          { status: 200 },
        ),
      nowSeconds: 2,
      plan: {
        feeAction: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" },
      },
      proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
      signTypedData: async () => [],
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).toBe(STRK20_SUBMISSION_UNAVAILABLE);
  });
});
