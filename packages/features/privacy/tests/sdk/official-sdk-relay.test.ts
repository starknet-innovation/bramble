/**
 * Relay-route approval invariants. A private operation must not include the
 * sender's public account solely to pay the pool fee.
 */
import { describe, expect, test } from "bun:test";
import { createOfficialStrk20Service } from "@mc-wallet/privacy/official-sdk-service";
import { buildErc20ApproveCall } from "@mc-wallet/starknet/rpc-assets";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@mc-wallet/wallet-model/networks";
import type { Strk20Action } from "@mc-wallet/wallet-protocol/strk20";
import { OutsideExecutionVersion, outsideExecution } from "starknet";
import {
  officialBuilder as builder,
  STRK20_SDK_CONTEXT as context,
  executeResult,
  STRK20_POOL_ADDRESS as poolAddress,
  sdkRuntime as runtime,
  strk20ProviderFor,
  STRK20_SDK_TOKEN as token,
} from "../support/official-sdk";

const POOL_FEE_6_STRK = "0x53444835ec580000";
const depositApproval = buildErc20ApproveCall(STRK_TOKEN_ADDRESS, poolAddress, 0x64n);
const relayContext = {
  ...context,
  config: {
    discoveryUrl: "https://discovery.example",
    paymaster: { feeToken: STRK_TOKEN_ADDRESS, url: "https://relay.example" },
    poolAddress,
    proverUrl: "https://prover.example",
  },
};

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
        id: "mc-wallet-strk20",
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
          id: "mc-wallet-strk20",
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
        id: "mc-wallet-strk20",
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
      account: { ...relayContext.account, accountContractType: "argent" as const },
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
    ).rejects.toThrow("strk20 private submission unavailable");
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
