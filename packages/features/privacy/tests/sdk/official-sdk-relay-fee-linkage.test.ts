/**
 * Relay fee token versus the rest of the batch: the fee may not be paid in a
 * token the batch deposits (Sherlock 189), an `OPEN` receipt never makes its
 * token the fee token (Sherlock 232), and a STRK fee quoted under another
 * configured fee token is submittable (Sherlock 233).
 */
import { describe, expect, test } from "bun:test";
import { createOfficialStrk20Service } from "@bramble/privacy/official-sdk-service";
import { quoteStrk20Plan, type Strk20Service, submitStrk20Actions } from "@bramble/privacy/service";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import {
  officialBuilder as builder,
  executeResult,
  STRK20_POOL_FEE_6_STRK as POOL_FEE_6_STRK,
  STRK20_RELAY_CONTEXT as relayContext,
  sdkRuntime as runtime,
  strk20ProviderFor,
} from "../support/official-sdk";

const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const PRIVACY_LEAK = "strk20 privacy leak";

type PoolFeeBody = {
  readonly method: string;
  readonly params: {
    readonly parameters: { readonly fee_mode: { readonly pool_fee_token: string } };
  };
};

// A relay that quotes in whichever fee token the wallet asks for, unless told
// to refuse it, and records every quote and execution.
const relay = (input: {
  readonly configuredFeeToken?: string;
  readonly refuse?: readonly string[];
}) => {
  const requested: string[] = [];
  const executed: string[] = [];
  const context = {
    ...relayContext,
    config: {
      ...relayContext.config,
      paymaster: {
        feeToken: input.configuredFeeToken ?? STRK_TOKEN_ADDRESS,
        url: "https://relay.example",
      },
    },
  };
  const service = createOfficialStrk20Service({
    feeReference: async () => 1_000n,
    http: async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as PoolFeeBody;
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
        return Response.json({
          error: { code: 151, message: "pool_fee_token is not supported" },
          id: "bramble-strk20",
          jsonrpc: "2.0",
        });
      }
      return Response.json({
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
      });
    },
    nowSeconds: () => 1_000,
    providerFor: strk20ProviderFor({ poolFee: POOL_FEE_6_STRK }),
    sdk: runtime(() => ({
      build: () => builder(),
      // Enough private STRK and USDC for any spend and fee these cases make.
      discoverNotes: async () => ({
        notes: new Map([
          [BigInt(STRK_TOKEN_ADDRESS), [{ amount: 10n ** 21n }]],
          [BigInt(USDC), [{ amount: 10n ** 21n }]],
        ]),
      }),
      executeWithInvocation: async () => executeResult(),
    })),
  });
  return { context, executed, requested, service };
};

const deposit = (token: string): Strk20Action => ({ amount: "0x5", token, type: "deposit" });
const transfer = (token: string, amount = "0x1"): Strk20Action => ({
  amount,
  recipient: "0x999",
  token,
  type: "transfer",
});

// A service whose relay quotes the fee in `feeToken`, recording executions.
// Deposits need the relay's typed data on the official adapter, which this
// policy check does not depend on, so the service boundary is faked here.
const quotingIn = (feeToken: string) => {
  const executed: string[] = [];
  const service: Strk20Service = {
    async prepare() {
      throw new Error("not used");
    },
    async poolFee() {
      return "0x1";
    },
    async privateBalances({ tokens }) {
      return tokens.map((token) => ({ balance: "0x64", token }));
    },
    async quoteActions() {
      return { feeAction: { amount: "0x1", recipient: "0x2", token: feeToken, type: "withdraw" } };
    },
    async shadowAccountCommitment() {
      return "0x7";
    },
    async submitActions(input) {
      executed.push(input.plan.mode === "account" ? "account" : input.plan.feeAction.token);
      return { transactionHash: "0xabc" };
    },
    async submitPrepared() {
      return { transactionHash: "0xabc" };
    },
  };
  return { executed, service };
};

describe("a relay fee in a token the batch deposits (Sherlock 189)", () => {
  test("is refused before review", async () => {
    const { service } = quotingIn(STRK_TOKEN_ADDRESS);
    await expect(
      quoteStrk20Plan(service, {
        ...relayContext,
        actions: [deposit(STRK_TOKEN_ADDRESS), transfer(STRK_TOKEN_ADDRESS)],
      }),
    ).rejects.toThrow(PRIVACY_LEAK);
  });

  test("is refused whichever token the batch spends", async () => {
    const { service } = quotingIn(STRK_TOKEN_ADDRESS);
    await expect(
      quoteStrk20Plan(service, {
        ...relayContext,
        actions: [deposit(STRK_TOKEN_ADDRESS), transfer(USDC)],
      }),
    ).rejects.toThrow(PRIVACY_LEAK);
  });

  test("is not raised when the fee is in a token the batch does not deposit", async () => {
    const { service } = quotingIn(STRK_TOKEN_ADDRESS);
    const plan = await quoteStrk20Plan(service, {
      ...relayContext,
      actions: [deposit(USDC), transfer(USDC)],
    });
    expect(plan.mode).not.toBe("account");
  });

  test("is refused at submission, before anything is sent", async () => {
    const { executed, service } = quotingIn(STRK_TOKEN_ADDRESS);
    const plan = await quoteStrk20Plan(service, {
      ...relayContext,
      actions: [deposit(USDC), transfer(USDC)],
    });
    await expect(
      submitStrk20Actions(service, {
        ...relayContext,
        actions: [deposit(STRK_TOKEN_ADDRESS), transfer(STRK_TOKEN_ADDRESS)],
        plan,
      }),
    ).rejects.toThrow(PRIVACY_LEAK);
    expect(executed).toEqual([]);
  });

  test("does not apply to a deposit-only batch paid from the public account", async () => {
    const { service } = quotingIn(STRK_TOKEN_ADDRESS);
    await expect(
      quoteStrk20Plan(service, { ...relayContext, actions: [deposit(STRK_TOKEN_ADDRESS)] }),
    ).resolves.toEqual({ mode: "account", poolFeeFri: "0x1" });
  });
});

describe("an OPEN receipt (Sherlock 232)", () => {
  test("keeps the configured fee token instead of the token it receives", async () => {
    const { context, requested, service } = relay({});
    const plan = await quoteStrk20Plan(service, {
      ...context,
      actions: [
        { amount: "OPEN", recipient: "0x999", token: USDC, type: "transfer" },
        { calldata: ["0x1"], contract: "0x555", type: "invoke" },
      ],
    });
    expect(requested.map((token) => sameFelt(token, STRK_TOKEN_ADDRESS))).toEqual([true]);
    if (plan.mode === "account") {
      throw new Error("expected the relay route");
    }
    expect(sameFelt(plan.feeAction.token, STRK_TOKEN_ADDRESS)).toBe(true);
  });

  test("still lets a real spend of the same token choose it", async () => {
    const { context, service } = relay({});
    const plan = await quoteStrk20Plan(service, {
      ...context,
      actions: [
        { amount: "OPEN", recipient: "0x999", token: USDC, type: "transfer" },
        transfer(USDC),
      ],
    });
    if (plan.mode === "account") {
      throw new Error("expected the relay route");
    }
    expect(sameFelt(plan.feeAction.token, USDC)).toBe(true);
  });
});

describe("a STRK fee under another configured fee token (Sherlock 233)", () => {
  test("is submitted as quoted", async () => {
    const { context, executed, service } = relay({ configuredFeeToken: USDC });
    const actions = [transfer(STRK_TOKEN_ADDRESS)];
    const plan = await service.quoteActions({ ...context, actions });
    if (plan.mode === "account") {
      throw new Error("expected the relay route");
    }
    expect(sameFelt(plan.feeAction.token, STRK_TOKEN_ADDRESS)).toBe(true);
    expect(plan.feeCeiling).toBeUndefined();

    const submitted = await service.submitActions({ ...context, actions, plan });

    expect(submitted.transactionHash).toBe("0xabc");
    expect(executed.map((token) => sameFelt(token, STRK_TOKEN_ADDRESS))).toEqual([true]);
  });

  test("does not admit a third token that carries no ceiling", async () => {
    const { context, executed, service } = relay({ configuredFeeToken: USDC });
    const actions = [transfer(STRK_TOKEN_ADDRESS)];
    const plan = await service.quoteActions({ ...context, actions });
    if (plan.mode === "account") {
      throw new Error("expected the relay route");
    }
    const forged = { ...plan, feeAction: { ...plan.feeAction, token: "0x777" } };
    await expect(service.submitActions({ ...context, actions, plan: forged })).rejects.toThrow(
      "strk20 private submission unavailable",
    );
    expect(executed).toEqual([]);
  });
});
