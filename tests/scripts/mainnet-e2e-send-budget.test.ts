/**
 * The per-send check the live scripts run before signing. A run may spend
 * only STRK and native USDC, and refuses the signature that would cross its
 * tier's per-run cap rather than noticing afterwards.
 */
import { describe, expect, test } from "bun:test";
import { STRK_TOKEN_ADDRESS, USDC_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import type { Call, RpcProvider } from "starknet";
import { broadcastReviewedSend, type TokenAttempt } from "../../scripts/gasless-mainnet-attempt";
import {
  MAINNET_E2E_CI_OPT_IN,
  MAINNET_E2E_ENVIRONMENT,
  MAINNET_E2E_REF,
  MAINNET_E2E_REPOSITORY,
  MAINNET_E2E_WORKFLOW_NAME,
  mainnetE2eWorkflowRef,
} from "../../scripts/mainnet-e2e-guard";
import { createSendBudget, sendBudgetFor } from "../../scripts/mainnet-e2e-send-budget";
import { spendCeilings } from "../../scripts/mainnet-e2e-spend";

const OTHER_TOKEN = "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8";

const allowed = (tier?: string): Record<string, string> => ({
  BRAMBLE_MAINNET_E2E_CI: MAINNET_E2E_CI_OPT_IN,
  BRAMBLE_MAINNET_E2E_ENVIRONMENT: MAINNET_E2E_ENVIRONMENT,
  CI: "true",
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "schedule",
  GITHUB_REF: MAINNET_E2E_REF,
  GITHUB_REPOSITORY: MAINNET_E2E_REPOSITORY,
  GITHUB_WORKFLOW: MAINNET_E2E_WORKFLOW_NAME,
  GITHUB_WORKFLOW_REF: mainnetE2eWorkflowRef(),
  ...(tier === undefined ? {} : { MAINNET_E2E_SPEND_TIER: tier }),
});

describe("mainnet send budget", () => {
  test("charges up to the cap and refuses the send that would cross it", () => {
    const cap = spendCeilings("standard").usdc.capRaw;
    const budget = createSendBudget("standard");
    budget.charge(USDC_TOKEN_ADDRESS, cap - 1n);
    expect(() => budget.charge(USDC_TOKEN_ADDRESS, 2n)).toThrow("over the");
    // The refused charge was not recorded, so the last unit still fits.
    budget.charge(USDC_TOKEN_ADDRESS.toUpperCase().replace("0X", "0x"), 1n);
    expect(() => budget.charge(USDC_TOKEN_ADDRESS, 1n)).toThrow("Refusing to sign");
  });

  test("keeps STRK and USDC totals apart and refuses any other token", () => {
    const budget = createSendBudget("standard");
    budget.charge(USDC_TOKEN_ADDRESS, spendCeilings("standard").usdc.capRaw);
    budget.charge(STRK_TOKEN_ADDRESS, spendCeilings("standard").strk.capRaw);
    expect(() => createSendBudget("standard").charge(OTHER_TOKEN, 1n)).toThrow(
      "only spend STRK or native USDC",
    );
    expect(() => createSendBudget("standard").charge(USDC_TOKEN_ADDRESS, -1n)).toThrow(
      "must not be negative",
    );
  });

  test("uses the tier's cap", () => {
    const strk20 = createSendBudget("strk20");
    strk20.charge(STRK_TOKEN_ADDRESS, spendCeilings("strk20").strk.capRaw);
    expect(() =>
      createSendBudget("standard").charge(
        STRK_TOKEN_ADDRESS,
        spendCeilings("standard").strk.capRaw + 1n,
      ),
    ).toThrow("per-run cap");
  });

  test("applies only to the Mainnet E2E workflow and never signs unbudgeted in CI", () => {
    expect(sendBudgetFor({})).toBeNull();
    expect(sendBudgetFor(allowed())).not.toBeNull();
    expect(sendBudgetFor(allowed("strk20"))).not.toBeNull();
    expect(() => sendBudgetFor(allowed("unlimited"))).toThrow("standard or strk20");
    expect(() => sendBudgetFor({ CI: "true" })).toThrow("local-only");
  });
});

describe("gasless broadcast charges the budget before signing", () => {
  const provider = {
    callContract: async () => ["0x10", "0x0"],
  } as unknown as RpcProvider;
  const attempt = (budget: TokenAttempt["budget"]): TokenAttempt =>
    ({
      account: { address: "0x123", label: "fixture", privateKey: "0x456", publicKey: null },
      budget,
      classHash: "0x1",
      family: "openzeppelin",
      listed: [],
      provider,
      route: { enabled: true, forwarder: "0x2" },
      token: { address: USDC_TOKEN_ADDRESS, decimals: 6, symbol: "USDC" },
      transport: {
        executed: () => 0,
        http: fetch,
        lastExchange: () => ({ request: "", status: 0, text: "" }),
      },
    }) as unknown as TokenAttempt;
  const call: Call = { calldata: [], contractAddress: "0x3", entrypoint: "transfer" };
  const offer = (tokenAddress: string, amount: bigint) => ({
    amount: amount.toString(),
    decimals: 6,
    label: "USDC",
    tokenAddress,
  });

  test("an over-budget or off-list fee never reaches the signer", async () => {
    const cap = spendCeilings("standard").usdc.capRaw;
    let submits = 0;
    const spy = (async () => {
      submits += 1;
      throw new Error("signer reached");
    }) as unknown as Parameters<typeof broadcastReviewedSend>[4];

    await expect(
      broadcastReviewedSend(
        attempt(createSendBudget("standard")),
        call,
        offer(USDC_TOKEN_ADDRESS, cap + 1n),
        1n,
        spy,
      ),
    ).rejects.toThrow("Refusing to sign");
    await expect(
      broadcastReviewedSend(attempt(createSendBudget("standard")), call, offer("0x4", 1n), 1n, spy),
    ).rejects.toThrow("only spend STRK or native USDC");
    expect(submits).toBe(0);

    // Within the cap the send goes on to the signer.
    const original = console.log;
    console.log = () => undefined;
    try {
      expect(
        await broadcastReviewedSend(
          attempt(createSendBudget("standard")),
          call,
          offer(USDC_TOKEN_ADDRESS, cap),
          1n,
          spy,
        ),
      ).toBe(false);
    } finally {
      console.log = original;
    }
    expect(submits).toBe(1);
  });
});
