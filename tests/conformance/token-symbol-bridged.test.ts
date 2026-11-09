/**
 * Issue 645: the shared token-symbol grammar admits exactly one bridged `.e`
 * suffix, so the curated mainnet `USDC.e` passes every layer that reads a
 * symbol — the scan's suggestions survive the panel's reader — while every
 * other widening stays refused.
 */
import { describe, expect, test } from "bun:test";
import { isTokenSymbol, normalizeTokenSymbol } from "@bramble/core/json";
import { knownTokensForNetwork } from "@bramble/portfolio/token-registry";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { isTokenBalance } from "@bramble/starknet/rpc";
import { createMemoryStore } from "@bramble/store/kv";
import type { DerivedAccountRef } from "@bramble/wallet-model/accounts";
import { isTokenConfig } from "@bramble/wallet-model/preferences";
import { watchAssetToken } from "../../apps/extension/src/background/provider/watch-asset";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import { readDetectedTokens } from "../../packages/presentation/wallet-ui/src/popup/responses/responses-balances";
import {
  account,
  createWallet,
  extensionSender,
  testExtension,
  vaultPassphrase,
} from "../support/background-wallet-stub";
import { makeRuntimeRpc } from "../support/runtime-rpc-stub";

const bridgedUsdc = () => {
  const token = knownTokensForNetwork("SN_MAIN").find((known) => known.symbol === "USDC.e");
  if (!token) throw new Error("registry has no USDC.e");
  return token;
};

describe("bridged .e token symbols", () => {
  test("the grammar admits one lowercase .e suffix on an otherwise valid ticker", () => {
    for (const symbol of ["USDC.e", "ETH.e", "AB.e", "WBTC2.e", "ABCDEFGHIJKL.e"]) {
      expect(isTokenSymbol(symbol)).toBe(true);
    }
    for (const symbol of [
      "USDC.E",
      "USDC.e.e",
      "USDC.ee",
      "USDC.x",
      "USDC-e",
      "USDCe",
      "usdc.e",
      ".e",
      "A.e",
      "ABCDEFGHIJKLM.e",
      "USDC.e ",
      "US.DC",
    ]) {
      expect(isTokenSymbol(symbol)).toBe(false);
    }
  });

  test("metadata readers normalize the suffix the grammar admits", () => {
    // watch-asset and wallet.addToken uppercase chain metadata; the suffix must
    // survive that, or a bridged ticker is refused and a spoof is never seen.
    expect(normalizeTokenSymbol(" eth.e ")).toBe("ETH.e");
    expect(normalizeTokenSymbol("USDC.E")).toBe("USDC.e");
    expect(normalizeTokenSymbol("usdc")).toBe("USDC");
    expect(isTokenSymbol(normalizeTokenSymbol("usdc.e.e"))).toBe(false);
  });

  test("every layer that reads a symbol accepts the curated USDC.e", () => {
    const token = bridgedUsdc();
    expect(isTokenConfig(token)).toBe(true);
    expect(isTokenBalance({ ...token, balance: "1000000", formatted: "1" })).toBe(true);
    expect(
      watchAssetToken(
        { address: token.address },
        { decimals: 6, name: "Bridged USDC", symbol: "USDC.e" },
        "SN_MAIN",
      )?.symbol,
    ).toBe("USDC.e");
    // Every curated token is storable, so a scan can suggest each one.
    for (const known of knownTokensForNetwork("SN_MAIN")) {
      expect(isTokenConfig(known)).toBe(true);
    }
  });

  const mainnetHandler = async (rpc: Parameters<typeof makeRuntimeRpc>[0]) => {
    const mainnet: DerivedAccountRef = {
      ...account,
      address: "0xabcabcdef",
      id: "SN_MAIN:0xabcabcdef",
      networkId: "SN_MAIN",
    };
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
    await preferencesStore.setActiveNetwork("SN_MAIN");
    const handler = createMessageHandler(
      createWallet({ accounts: [mainnet], activeAccountId: () => mainnet.id }),
      testExtension,
      { preferencesStore, runtimeRpc: makeRuntimeRpc(rpc), session },
    );
    return { handler, preferencesStore };
  };

  test("a scan of an account holding bridged USDC suggests it", async () => {
    const token = bridgedUsdc();
    const { handler } = await mainnetHandler({
      getTokenBalances: async ({ tokens }) =>
        tokens.map((candidate) => ({
          ...candidate,
          balance: candidate.symbol === "USDC.e" ? "2500000" : "0",
          formatted: candidate.symbol === "USDC.e" ? "2.5" : "0",
        })),
    });

    const response = await handler({ type: "wallet.detectTokens" }, extensionSender);
    expect(readDetectedTokens(response)?.map((row) => row.id)).toEqual([token.id]);
  });

  test("wallet.addToken stores a bridged ticker read from chain metadata", async () => {
    const token = bridgedUsdc();
    const { handler, preferencesStore } = await mainnetHandler({
      getTokenMetadata: async () => ({ decimals: 6, name: "Bridged USDC", symbol: "usdc.e" }),
    });
    const response = await handler(
      { address: token.address, type: "wallet.addToken" },
      extensionSender,
    );
    expect(response).toMatchObject({ ok: true });
    const stored = (await preferencesStore.read()).tokens.find((row) => row.id === token.id);
    expect(stored?.symbol).toBe("USDC.e");
  });
});
