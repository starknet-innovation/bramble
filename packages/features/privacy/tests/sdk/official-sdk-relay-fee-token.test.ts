/**
 * Relay fee-token selection: the fee follows the token being sent, falls back
 * to the configured token when the relay refuses, and — the case #355 exists
 * for — executes in the token the plan was quoted in. Split from
 * `./official-sdk-relay.test` to keep both under the file-size gate.
 */
import { describe, expect, test } from "bun:test";
import { createOfficialStrk20Service } from "@bramble/privacy/official-sdk-service";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import {
  officialBuilder as builder,
  executeResult,
  STRK20_POOL_FEE_6_STRK as POOL_FEE_6_STRK,
  STRK20_RELAY_CONTEXT as relayContext,
  sdkRuntime as runtime,
  strk20ProviderFor,
} from "../support/official-sdk";

/**
 * The fee follows the token being sent, and lands back on the configured token
 * when the relay will not take it. The relay is the only authority on which
 * tokens `sponsored_private` accepts — it publishes no list — so the refusal
 * has to be recoverable rather than predicted.
 */
describe("fee token follows the token being sent", () => {
  const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";

  const quoteRequestingTokens = async (input: {
    readonly refuse?: readonly string[];
    readonly sent: string;
  }) => {
    const requested: string[] = [];
    const executed: string[] = [];
    const service = createOfficialStrk20Service({
      feeReference: async () => 1_000n,
      http: async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          readonly method: string;
          readonly params: {
            readonly parameters: { readonly fee_mode: { readonly pool_fee_token: string } };
          };
        };
        const feeToken = body.params.parameters.fee_mode.pool_fee_token;
        if (body.method === "paymaster_executeTransaction") {
          executed.push(feeToken);
          return Response.json({
            id: "bramble-strk20",
            jsonrpc: "2.0",
            result: { transaction_hash: "0xabc" },
          });
        }
        requested.push(feeToken);
        if (input.refuse?.some((token) => sameFelt(token, feeToken))) {
          return new Response(
            JSON.stringify({
              error: { code: 151, message: "pool_fee_token is not supported" },
              id: "bramble-strk20",
              jsonrpc: "2.0",
            }),
            { headers: { "content-type": "application/json" }, status: 200 },
          );
        }
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
              // STRK is matched against the pool's on-chain charge exactly; a
              // converted token only has to sit inside its ceiling.
              fee_action: {
                amount: sameFelt(feeToken, STRK_TOKEN_ADDRESS) ? POOL_FEE_6_STRK : "0x1",
                recipient: "0x2",
                token: feeToken,
                type: "withdraw",
              },
              parameters: {
                fee_mode: { mode: "sponsored_private", pool_fee_token: feeToken, tip: "normal" },
                time_bounds: null,
                version: "0x1",
              },
              type: "apply_action",
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      },
      nowSeconds: () => 1_000,
      providerFor: strk20ProviderFor({ poolFee: POOL_FEE_6_STRK }),
      sdk: runtime(() => ({
        build: () => builder(executeResult()),
        // Enough shielded balance in the sent token for the transfer and a
        // fee in that same token, so submission's balance guard is not what
        // decides these cases.
        discoverNotes: async () => ({
          notes: new Map([[BigInt(input.sent), [{ amount: 5n }]]]),
        }),
        executeWithInvocation: async () => executeResult(),
      })),
    });
    const actions = [
      { amount: "0x1", recipient: "0x999", token: input.sent, type: "transfer" as const },
    ];
    const plan = await service.quoteActions({ ...relayContext, actions });
    const submit = () => service.submitActions({ ...relayContext, actions, plan });
    return { executed, plan, requested, submit };
  };

  test("quotes the sent token, not the configured default", async () => {
    const { plan, requested } = await quoteRequestingTokens({ sent: USDC });

    expect(requested.map((value) => sameFelt(value, USDC))).toEqual([true]);
    if (plan.mode === "account") {
      throw new Error("expected the relay route");
    }
    expect(sameFelt(plan.feeAction.token, USDC)).toBe(true);
  });

  // #355: the configured default is STRK, the quote converted to USDC. The
  // execution must name USDC too, or the relay validates a route the user
  // never reviewed.
  test("executes in the token the plan was quoted in, not the configured default", async () => {
    const { executed, plan, submit } = await quoteRequestingTokens({ sent: USDC });
    if (plan.mode === "account") {
      throw new Error("expected the relay route");
    }
    expect(sameFelt(plan.feeAction.token, USDC)).toBe(true);

    const submitted = await submit();

    expect(submitted.transactionHash).toBe("0xabc");
    expect(executed.map((value) => sameFelt(value, USDC))).toEqual([true]);
  });

  test("falls back to the configured token when the relay refuses the sent one", async () => {
    const { plan, requested } = await quoteRequestingTokens({ refuse: [USDC], sent: USDC });

    expect(requested).toHaveLength(2);
    expect(sameFelt(requested[0] ?? "", USDC)).toBe(true);
    expect(sameFelt(requested[1] ?? "", STRK_TOKEN_ADDRESS)).toBe(true);
    if (plan.mode === "account") {
      throw new Error("expected the relay route");
    }
    expect(sameFelt(plan.feeAction.token, STRK_TOKEN_ADDRESS)).toBe(true);
    // The fallback is the exact route, so it carries no conversion band.
    expect(plan.feeCeiling).toBeUndefined();
  });

  test("asks once when the sent token is already the configured one", async () => {
    const { requested } = await quoteRequestingTokens({ sent: STRK_TOKEN_ADDRESS });

    expect(requested).toHaveLength(1);
    expect(sameFelt(requested[0] ?? "", STRK_TOKEN_ADDRESS)).toBe(true);
  });

  test("surfaces a refusal that is not about the fee token instead of retrying", async () => {
    await expect(
      quoteRequestingTokens({ refuse: [USDC, STRK_TOKEN_ADDRESS], sent: USDC }),
    ).rejects.toThrow("strk20 private submission unavailable");
  });
});
