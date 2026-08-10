/**
 * Strict privacy-paymaster JSON-RPC contract tests. The plan shown to the user
 * must be the same fee action and typed data later submitted.
 */
import { describe, expect, test } from "bun:test";
import { type Call, OutsideExecutionVersion, outsideExecution, type TypedData } from "starknet";
import {
  buildStrk20PaymasterPlan,
  submitStrk20PaymasterPlan,
} from "../../../src/starknet/strk20/paymaster";

const config = { feeToken: "0x3", url: "https://paymaster.example" };
const chainId = "0x534e5f5345504f4c4941";
const call: Call = {
  calldata: ["0x1"],
  contractAddress: "0x2",
  entrypoint: "apply_actions",
};
const outsideTypedData = (calls: readonly Call[] = [call]): TypedData =>
  outsideExecution.getTypedData(
    chainId,
    { caller: "0x99", execute_after: "0x1", execute_before: "0x100" },
    "0x5",
    [...calls],
    OutsideExecutionVersion.V2,
  );

const response = (result: unknown): Response =>
  new Response(JSON.stringify({ id: "mc-wallet-strk20", jsonrpc: "2.0", result }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });

const quoteResult = (input: {
  readonly feeToken?: string;
  readonly type: "apply_action" | "invoke_and_apply_action";
  readonly typedData?: unknown;
}): Record<string, unknown> => ({
  fee: {
    estimated_fee_in_gas_token: "0x2",
    estimated_fee_in_strk: "0x2",
    gas_token_price_in_strk: "0x1",
    suggested_max_fee_in_gas_token: "0x3",
    suggested_max_fee_in_strk: "0x3",
  },
  fee_action: {
    amount: "0x5",
    recipient: "0x4",
    token: input.feeToken ?? "0x3",
    type: "withdraw",
  },
  parameters: {
    fee_mode: { mode: "sponsored_private", pool_fee_token: "0x3", tip: "normal" },
    time_bounds: null,
    version: "0x1",
  },
  type: input.type,
  ...(input.type === "invoke_and_apply_action"
    ? { typed_data: input.typedData ?? outsideTypedData() }
    : {}),
});

describe("STRK20 paymaster boundary", () => {
  test("freezes a validated fee plan and outside-execution typed data", async () => {
    const requests: Record<string, unknown>[] = [];
    const approvalCall = { ...call, calldata: ["291", "100", "0"] };
    const plan = await buildStrk20PaymasterPlan({
      accountAddress: "0x1",
      approveCalls: [approvalCall],
      chainId,
      config,
      http: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return response(
          quoteResult({
            type: "invoke_and_apply_action",
            typedData: outsideTypedData([approvalCall]),
          }),
        );
      },
      nowSeconds: 2,
      poolAddress: "0x2",
    });
    expect(plan.feeAction).toEqual({
      amount: "0x5",
      recipient: "0x4",
      token: "0x3",
      type: "withdraw",
    });
    expect(plan.typedData).toBeDefined();
    expect(plan.authorization).toEqual({
      caller: "0x99",
      executeAfter: "0x1",
      executeBefore: "0x100",
      publicCallCount: 1,
    });
    expect(requests[0]?.["method"]).toBe("paymaster_buildTransaction");
    expect(requests[0]?.["params"]).toMatchObject({
      parameters: {
        fee_mode: { pool_fee_token: "0x3" },
      },
      transaction: {
        apply_action: { pool_address: "0x2" },
        invoke: {
          calls: [{ calldata: ["0x123", "0x64", "0x0"], to: "0x2" }],
          user_address: "0x1",
        },
      },
    });
  });

  test("rejects a fee action for a token other than the configured fee token", async () => {
    await expect(
      buildStrk20PaymasterPlan({
        accountAddress: "0x1",
        approveCalls: [],
        chainId,
        config,
        http: async () => response(quoteResult({ feeToken: "0x99", type: "apply_action" })),
        nowSeconds: 2,
        poolAddress: "0x2",
      }),
    ).rejects.toThrow("strk20 private submission unavailable");
  });

  test("rejects substituted outside-execution calls before signing", async () => {
    await expect(
      buildStrk20PaymasterPlan({
        accountAddress: "0x1",
        approveCalls: [call],
        chainId,
        config,
        http: async () =>
          response(
            quoteResult({
              type: "invoke_and_apply_action",
              typedData: outsideTypedData([
                { calldata: ["0xdead"], contractAddress: "0x77", entrypoint: "transfer" },
              ]),
            }),
          ),
        nowSeconds: 2,
        poolAddress: "0x2",
      }),
    ).rejects.toThrow("strk20 private submission unavailable");
  });

  test("rejects an invalid outside-execution window before signing", async () => {
    await expect(
      buildStrk20PaymasterPlan({
        accountAddress: "0x1",
        approveCalls: [call],
        chainId,
        config,
        http: async () =>
          response(
            quoteResult({
              type: "invoke_and_apply_action",
              typedData: outsideExecution.getTypedData(
                chainId,
                { caller: "0x99", execute_after: "0x100", execute_before: "0x100" },
                "0x5",
                [call],
                OutsideExecutionVersion.V2,
              ),
            }),
          ),
        nowSeconds: 2,
        poolAddress: "0x2",
      }),
    ).rejects.toThrow("strk20 private submission unavailable");
  });

  for (const [label, executeAfter, executeBefore, nowSeconds] of [
    ["expired", "0x1", "0x100", 256],
    ["not yet live", "0x2", "0x100", 2],
    ["outside u64", "0x1", "0x10000000000000000", 2],
  ] as const) {
    test(`rejects an ${label} outside-execution window`, async () => {
      await expect(
        buildStrk20PaymasterPlan({
          accountAddress: "0x1",
          approveCalls: [call],
          chainId,
          config,
          http: async () =>
            response(
              quoteResult({
                type: "invoke_and_apply_action",
                typedData: outsideExecution.getTypedData(
                  chainId,
                  { caller: "0x99", execute_after: executeAfter, execute_before: executeBefore },
                  "0x5",
                  [call],
                  OutsideExecutionVersion.V2,
                ),
              }),
            ),
          nowSeconds,
          poolAddress: "0x2",
        }),
      ).rejects.toThrow("strk20 private submission unavailable");
    });
  }

  test("accepts the deployed relay's compact fee and parameter metadata", async () => {
    const result = quoteResult({ type: "apply_action" });
    result["fee"] = {
      estimated_fee_in_strk: "0x2",
      gas_token_price_in_strk: "0x1",
      suggested_max_fee_in_strk: "0x3",
    };
    result["parameters"] = { fee_mode: { mode: "sponsored_private" }, version: "0x1" };

    const plan = await buildStrk20PaymasterPlan({
      accountAddress: "0x1",
      approveCalls: [],
      chainId,
      config,
      http: async () => response(result),
      nowSeconds: 2,
      poolAddress: "0x2",
    });

    expect(plan.mode).toBe("private-relay");
  });

  test("rejects mismatched or partially formed quote metadata", async () => {
    const base = quoteResult({ type: "apply_action" });
    for (const result of [
      { ...base, type: "invoke_and_apply_action" },
      { ...base, unexpected: "field" },
      { ...base, parameters: { fee_mode: { mode: "sponsored" }, version: "0x1" } },
      {
        ...base,
        parameters: {
          fee_mode: { mode: "sponsored_private", pool_fee_token: "0x99" },
          version: "0x1",
        },
      },
      {
        ...base,
        fee: {
          estimated_fee_in_gas_token: "0x2",
          estimated_fee_in_strk: "0x2",
          gas_token_price_in_strk: "0x1",
          suggested_max_fee_in_strk: "0x3",
        },
      },
      { ...base, typed_data: outsideTypedData() },
    ]) {
      await expect(
        buildStrk20PaymasterPlan({
          accountAddress: "0x1",
          approveCalls: [],
          chainId,
          config,
          http: async () => response(result),
          nowSeconds: 2,
          poolAddress: "0x2",
        }),
      ).rejects.toThrow("strk20 private submission unavailable");
    }
  });

  test("rejects an invalid paymaster call before making a network request", async () => {
    let requested = false;
    await expect(
      buildStrk20PaymasterPlan({
        accountAddress: "0x1",
        approveCalls: [{ ...call, contractAddress: "0x0" }],
        chainId,
        config,
        http: async () => {
          requested = true;
          return response(quoteResult({ type: "invoke_and_apply_action" }));
        },
        nowSeconds: 2,
        poolAddress: "0x2",
      }),
    ).rejects.toThrow("strk20 private submission unavailable");
    expect(requested).toBe(false);
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
});
