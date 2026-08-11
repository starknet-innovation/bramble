/**
 * Strict privacy-paymaster JSON-RPC contract tests. The plan shown to the user
 * must be the same fee action and typed data later submitted.
 */
import { describe, expect, test } from "bun:test";
import { buildStrk20PaymasterPlan } from "@mc-wallet/privacy/paymaster";
import { type Call, OutsideExecutionVersion, outsideExecution } from "starknet";
import {
  paymasterCall as call,
  paymasterChainId as chainId,
  paymasterConfig as config,
  paymasterTypedData as outsideTypedData,
  paymasterResponse as response,
} from "../support/paymaster";

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
    recipient: input.type === "invoke_and_apply_action" ? "0x99" : "0x4",
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
      expectedFeeAmount: 5n,
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
      recipient: "0x99",
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

  test("serializes every public call felt as 0x hex, never compiled decimal", async () => {
    let body = "";
    // An ERC20 approve of 6 STRK: the u256 low limb compiles to a 19-digit
    // decimal, which the relay rejects outright unless converted to hex.
    const approve: Call = {
      calldata: ["0x2", "6000000000000000000", "0"],
      contractAddress: "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
      entrypoint: "approve",
    };
    await buildStrk20PaymasterPlan({
      accountAddress: "0x1",
      approveCalls: [approve],
      chainId,
      config,
      expectedFeeAmount: 5n,
      http: async (_url, init) => {
        body = String(init?.body);
        return response(
          quoteResult({
            type: "invoke_and_apply_action",
            typedData: outsideTypedData([approve]),
          }),
        );
      },
      nowSeconds: 2,
      poolAddress: "0x2",
    });

    const sent = JSON.parse(body) as {
      params: { transaction: { invoke: { calls: { calldata: string[]; to: string }[] } } };
    };
    const sentCall = sent.params.transaction.invoke.calls[0];
    expect(sentCall?.calldata).toEqual(["0x2", "0x53444835ec580000", "0x0"]);
    expect(sentCall?.to.startsWith("0x")).toBe(true);
    expect(body).not.toContain("6000000000000000000");
  });

  test("accepts the relay's real quote shape, echo and gas estimate included", async () => {
    // Exactly what starknet.paymaster.avnu.fi answers: the two fields the wallet
    // consumes plus its own echo of the request and a sponsored gas estimate.
    const plan = await buildStrk20PaymasterPlan({
      accountAddress: "0x1",
      approveCalls: [],
      chainId,
      config,
      expectedFeeAmount: 5n,
      http: async () =>
        response({
          fee: {
            estimated_fee_in_strk: "0x79e7f095ac3e5000",
            gas_token_price_in_strk: "0xde0b6b3a7640000",
            suggested_max_fee_in_strk: "0xc72f41552c0af000",
          },
          fee_action: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" },
          parameters: { fee_mode: { mode: "sponsored_private" }, version: "0x1" },
          type: "apply_action",
        }),
      nowSeconds: 2,
      poolAddress: "0x2",
    });

    expect(plan.mode).toBe("private-relay");
    expect(plan.feeAction.amount).toBe("0x5");
  });

  test("a genuinely unknown quote field still fails closed and says so", async () => {
    await expect(
      buildStrk20PaymasterPlan({
        accountAddress: "0x1",
        approveCalls: [],
        chainId,
        config,
        expectedFeeAmount: 5n,
        http: async () =>
          response({
            fee_action: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" },
            surprise: "unexpected",
          }),
        nowSeconds: 2,
        poolAddress: "0x2",
      }),
    ).rejects.toThrow("unexpected quote shape");
  });

  test("rejects a fee action for a token other than the configured fee token", async () => {
    await expect(
      buildStrk20PaymasterPlan({
        accountAddress: "0x1",
        approveCalls: [],
        chainId,
        config,
        expectedFeeAmount: 5n,
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
        expectedFeeAmount: 5n,
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
        expectedFeeAmount: 5n,
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
          expectedFeeAmount: 5n,
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
      expectedFeeAmount: 5n,
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
    ]) {
      await expect(
        buildStrk20PaymasterPlan({
          accountAddress: "0x1",
          approveCalls: [],
          chainId,
          config,
          expectedFeeAmount: 5n,
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
        expectedFeeAmount: 5n,
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
});
