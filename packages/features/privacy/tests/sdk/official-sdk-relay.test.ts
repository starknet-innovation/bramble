/**
 * Relay-route approval invariants. A private operation must not include the
 * sender's public account solely to pay the pool fee.
 */
import { describe, expect, test } from "bun:test";
import { STRK20_FEE_CEILING_MULTIPLIER } from "@bramble/privacy/fee-policy";
import { createOfficialStrk20Service } from "@bramble/privacy/official-sdk-service";
import { buildErc20ApproveCall } from "@bramble/starknet/rpc-assets";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import { OutsideExecutionVersion, outsideExecution } from "starknet";
import {
  officialBuilder as builder,
  STRK20_SDK_CONTEXT as context,
  executeResult,
  STRK20_POOL_FEE_6_STRK as POOL_FEE_6_STRK,
  STRK20_POOL_ADDRESS as poolAddress,
  STRK20_RELAY_CONTEXT as relayContext,
  sdkRuntime as runtime,
  strk20ProviderFor,
  STRK20_SDK_TOKEN as token,
} from "../support/official-sdk";

const depositApproval = buildErc20ApproveCall(STRK_TOKEN_ADDRESS, poolAddress, 0x64n);

const quotedTransaction = async (
  actions: readonly Strk20Action[],
): Promise<Record<string, unknown>> => {
  let transaction: Record<string, unknown> = {};
  const http = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as {
      readonly params: { readonly transaction: Record<string, unknown> };
    };
    transaction = body.params.transaction;
    const type = transaction["type"];
    return new Response(
      JSON.stringify({
        id: "bramble-strk20",
        jsonrpc: "2.0",
        result: {
          fee: {
            estimated_fee_in_gas_token: "0x1",
            estimated_fee_in_strk: "0x1",
            gas_token_price_in_strk: "0x1",
            suggested_max_fee_in_gas_token: "0x1",
            suggested_max_fee_in_strk: "0x1",
          },
          fee_action: {
            amount: POOL_FEE_6_STRK,
            recipient: type === "invoke_and_apply_action" ? "0x99" : "0x2",
            token: STRK_TOKEN_ADDRESS,
            type: "withdraw",
          },
          parameters: {
            fee_mode: {
              mode: "sponsored_private",
              pool_fee_token: STRK_TOKEN_ADDRESS,
              tip: "normal",
            },
            time_bounds: null,
            version: "0x1",
          },
          type,
          ...(type === "invoke_and_apply_action"
            ? {
                typed_data: outsideExecution.getTypedData(
                  "0x534e5f5345504f4c4941",
                  { caller: "0x99", execute_after: "0x3e7", execute_before: "0x7d0" },
                  "0x5",
                  [depositApproval],
                  OutsideExecutionVersion.V2,
                ),
              }
            : {}),
        },
      }),
      { headers: { "content-type": "application/json" }, status: 200 },
    );
  };
  const service = createOfficialStrk20Service({
    http,
    nowSeconds: () => 1_000,
    providerFor: strk20ProviderFor({ poolFee: POOL_FEE_6_STRK }),
    sdk: runtime(() => ({
      build: () => builder(executeResult()),
      discoverNotes: async () => ({ notes: new Map() }),
      executeWithInvocation: async () => executeResult(),
    })),
  });
  await service.quoteActions({ ...relayContext, actions });
  return transaction;
};

describe("relay quote approvals", () => {
  test("serializes an Argent Account signature for relay outside execution", async () => {
    let submittedSignature: unknown;
    const http = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as {
        readonly method: string;
        readonly params: {
          readonly transaction: {
            readonly invoke?: { readonly signature?: unknown };
            readonly type: string;
          };
        };
      };
      if (body.method === "paymaster_executeTransaction") {
        submittedSignature = body.params.transaction.invoke?.signature;
        return Response.json({
          id: "bramble-strk20",
          jsonrpc: "2.0",
          result: { transaction_hash: "0xabc" },
        });
      }
      const typedData = outsideExecution.getTypedData(
        "0x534e5f5345504f4c4941",
        { caller: "0x99", execute_after: "0x3e7", execute_before: "0x7d0" },
        "0x5",
        [depositApproval],
        OutsideExecutionVersion.V2,
      );
      return Response.json({
        id: "bramble-strk20",
        jsonrpc: "2.0",
        result: {
          fee: {
            estimated_fee_in_strk: "0x1",
            gas_token_price_in_strk: "0x1",
            suggested_max_fee_in_strk: "0x1",
          },
          fee_action: {
            amount: POOL_FEE_6_STRK,
            recipient: "0x99",
            token: STRK_TOKEN_ADDRESS,
            type: "withdraw",
          },
          parameters: {
            fee_mode: {
              mode: "sponsored_private",
              pool_fee_token: STRK_TOKEN_ADDRESS,
              tip: "normal",
            },
            time_bounds: null,
            version: "0x1",
          },
          type: "invoke_and_apply_action",
          typed_data: typedData,
        },
      });
    };
    const service = createOfficialStrk20Service({
      http,
      nowSeconds: () => 1_000,
      providerFor: strk20ProviderFor({ poolFee: POOL_FEE_6_STRK }),
      sdk: runtime(() => ({
        build: () => builder(executeResult()),
        discoverNotes: async () => ({ notes: new Map() }),
        executeWithInvocation: async () => executeResult(),
      })),
    });
    const argentContext = {
      ...relayContext,
      account: {
        ...relayContext.account,
        accountContractType: "argent" as const,
        deploymentSalt: relayContext.account.publicKeyX,
      },
    };
    const actions = [{ amount: "0x64", token: STRK_TOKEN_ADDRESS, type: "deposit" as const }];
    const plan = await service.quoteActions({ ...argentContext, actions });

    const submitted = await service.submitActions({ ...argentContext, actions, plan });
    expect(submitted.transactionHash).toBe("0xabc");
    expect(submitted.allowanceGrants).toHaveLength(1);
    expect(
      sameFelt(submitted.allowanceGrants?.[0]?.contractAddress ?? "", STRK_TOKEN_ADDRESS),
    ).toBe(true);
    expect(submittedSignature).toEqual(["1", "0", "0x1", "0x2", "0x3"]);
  });

  test("rejects an unpriceable non-STRK relay fee before contacting the paymaster", async () => {
    let requested = false;
    const service = createOfficialStrk20Service({
      http: async () => {
        requested = true;
        throw new Error("must not request");
      },
      nowSeconds: () => 1_000,
      providerFor: strk20ProviderFor({ poolFee: POOL_FEE_6_STRK }),
      sdk: runtime(() => ({
        build: () => builder(executeResult()),
        discoverNotes: async () => ({ notes: new Map() }),
        executeWithInvocation: async () => executeResult(),
      })),
    });

    await expect(
      service.quoteActions({
        ...relayContext,
        actions: [{ amount: "0x1", recipient: "0x999", token, type: "transfer" }],
        config: {
          ...relayContext.config,
          paymaster: { feeToken: token, url: "https://relay.example" },
        },
      }),
    ).rejects.toThrow("strk20 converted fee could not be verified independently");
    expect(requested).toBe(false);
  });

  test("does not add a sender-linked pool-fee approval to a private action", async () => {
    const transaction = await quotedTransaction([
      { amount: "0x1", recipient: "0x999", token, type: "transfer" },
    ]);

    expect(transaction["type"]).toBe("apply_action");
    expect(transaction["invoke"]).toBeUndefined();
    expect(JSON.stringify(transaction)).not.toContain(context.account.address);
  });

  test("preserves only the exact deposit approval required by a mixed batch", async () => {
    const transaction = await quotedTransaction([
      { amount: "0x64", token: STRK_TOKEN_ADDRESS, type: "deposit" },
      { amount: "0x1", recipient: "0x999", token, type: "transfer" },
    ]);
    const invoke = transaction["invoke"] as {
      readonly calls: readonly { readonly calldata: readonly string[]; readonly to: string }[];
      readonly user_address: string;
    };

    expect(transaction["type"]).toBe("invoke_and_apply_action");
    expect(invoke.user_address).toBe(context.account.address);
    expect(invoke.calls).toHaveLength(1);
    expect(invoke.calls[0]?.calldata).toEqual(["0x123", "0x64", "0x0"]);
    expect(sameFelt(invoke.calls[0]?.to ?? "", STRK_TOKEN_ADDRESS)).toBe(true);
  });
});

/**
 * A converted fee token has no on-chain value denominating it, so the relay's
 * own number is admitted only under a bound the relay did not supply. These
 * cases pin both directions of that bound and the record it leaves in the plan.
 */
describe("converted relay fee", () => {
  const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
  // What an independent price says 6 STRK is worth, in USDC base units.
  const REFERENCE = 1_200_000n;

  const quoteConvertedFee = async (input: {
    readonly quotedAmount: bigint;
    readonly reference?: bigint | null;
  }) => {
    const service = createOfficialStrk20Service({
      feeReference: async () => (input.reference === undefined ? REFERENCE : input.reference),
      http: async () =>
        new Response(
          JSON.stringify({
            id: "bramble-strk20",
            jsonrpc: "2.0",
            result: {
              fee: {
                estimated_fee_in_gas_token: "0x1",
                estimated_fee_in_strk: "0x1",
                gas_token_price_in_strk: "0x1",
                suggested_max_fee_in_gas_token: "0x1",
                suggested_max_fee_in_strk: "0x1",
              },
              fee_action: {
                amount: `0x${input.quotedAmount.toString(16)}`,
                recipient: "0x2",
                token: USDC,
                type: "withdraw",
              },
              parameters: {
                fee_mode: { mode: "sponsored_private", pool_fee_token: USDC, tip: "normal" },
                time_bounds: null,
                version: "0x1",
              },
              type: "apply_action",
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      nowSeconds: () => 1_000,
      providerFor: strk20ProviderFor({ poolFee: POOL_FEE_6_STRK }),
      sdk: runtime(() => ({
        build: () => builder(executeResult()),
        discoverNotes: async () => ({ notes: new Map() }),
        executeWithInvocation: async () => executeResult(),
      })),
    });
    // The batch spends USDC, so USDC is also the preferred fee token: this
    // exercises the converted bound on a single quote, not the fallback.
    return service.quoteActions({
      ...relayContext,
      actions: [{ amount: "0x1", recipient: "0x999", token: USDC, type: "transfer" }],
      config: {
        ...relayContext.config,
        paymaster: { feeToken: USDC, url: "https://relay.example" },
      },
    });
  };

  test("admits a quote inside the ceiling and records the bound it was admitted under", async () => {
    const plan = await quoteConvertedFee({ quotedAmount: REFERENCE });

    expect(plan.mode).toBe("private-relay");
    if (plan.mode === "account") {
      throw new Error("expected the relay route");
    }
    expect(plan.feeAction).toEqual({
      amount: `0x${REFERENCE.toString(16)}`,
      recipient: "0x2",
      token: USDC,
      type: "withdraw",
    });
    // The reviewed ceiling travels with the plan so submission re-checks the
    // same number, not one re-derived from a price that has since moved.
    expect(plan.feeCeiling).toEqual({
      ceiling: `0x${(REFERENCE * STRK20_FEE_CEILING_MULTIPLIER).toString(16)}`,
      reference: `0x${REFERENCE.toString(16)}`,
    });
  });

  test("admits a quote exactly at the ceiling", async () => {
    const plan = await quoteConvertedFee({
      quotedAmount: REFERENCE * STRK20_FEE_CEILING_MULTIPLIER,
    });

    expect(plan.mode).toBe("private-relay");
  });

  test("refuses a quote one unit above the ceiling", async () => {
    await expect(
      quoteConvertedFee({ quotedAmount: REFERENCE * STRK20_FEE_CEILING_MULTIPLIER + 1n }),
    ).rejects.toThrow("the relay returned a fee outside the reviewed route");
  });

  test("refuses the drain a relay-set rate would otherwise allow", async () => {
    await expect(quoteConvertedFee({ quotedAmount: 50_000_000_000n })).rejects.toThrow(
      "the relay returned a fee outside the reviewed route",
    );
  });

  test("refuses the route when the reference cannot price the token", async () => {
    await expect(quoteConvertedFee({ quotedAmount: REFERENCE, reference: null })).rejects.toThrow(
      "strk20 converted fee could not be verified independently",
    );
  });
});
