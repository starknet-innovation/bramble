/**
 * Shared helpers on the extension-owned privacy boundary.
 *
 * `publicBalance` is what every deposit is checked against, so its unreadable
 * case is the one that matters: an absent reading reports zero, which refuses
 * the deposit rather than proposing one against a balance nobody confirmed.
 */

import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import type {
  ActivePrivacyContext,
  Strk20WalletOpsDeps,
} from "../../../apps/extension/src/background/privacy/strk20-op-context";
import {
  errorText,
  publicBalance,
} from "../../../apps/extension/src/background/privacy/strk20-op-context";

const TOKEN = {
  address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  decimals: 18,
  id: "SN_MAIN:ETH:0x049d",
  name: "Ether",
  networkId: "SN_MAIN",
  symbol: "ETH",
};

const context = {
  accountContext: {
    account: { address: "0xabc" },
    rpcUrls: ["https://rpc.example"],
  },
  token: TOKEN,
} as unknown as ActivePrivacyContext;

const depsReturning = (
  balances: readonly { readonly balance: string }[],
): { readonly asked: unknown[]; readonly deps: Strk20WalletOpsDeps } => {
  const asked: unknown[] = [];
  return {
    asked,
    deps: {
      runtimeRpc: {
        getTokenBalances: async (input: unknown) => {
          asked.push(input);
          return balances;
        },
      },
    } as unknown as Strk20WalletOpsDeps,
  };
};

describe("publicBalance", () => {
  test("reads the active account's balance of the context token in raw units", async () => {
    const { asked, deps } = depsReturning([{ balance: "0xde0b6b3a7640000" }]);

    await expect(publicBalance(deps, context)).resolves.toBe(1_000_000_000_000_000_000n);
    expect(asked).toEqual([
      {
        accountAddress: "0xabc",
        rpcUrls: ["https://rpc.example"],
        tokens: [TOKEN],
      },
    ]);
  });

  test("reports zero when the balance cannot be read, so a deposit fails closed", async () => {
    const { deps } = depsReturning([]);

    await expect(publicBalance(deps, context)).resolves.toBe(0n);
  });
});

describe("errorText", () => {
  test("returns only curated wallet errors and otherwise the fallback", () => {
    expect(errorText(new WalletError("Not enough STRK"), "fallback")).toBe("Not enough STRK");
    expect(errorText(new Error("prover unavailable"), "fallback")).toBe("fallback");
    expect(errorText(new Error(""), "fallback")).toBe("fallback");
    expect(errorText("a thrown string", "fallback")).toBe("fallback");
    expect(errorText(undefined, "fallback")).toBe("fallback");
  });
});
