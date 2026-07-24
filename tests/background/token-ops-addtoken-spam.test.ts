/**
 * wallet.addToken now runs the full spam heuristics: a spoofed token is still
 * added but hidden by default, while a genuine token stays visible (A-L10).
 */
import { describe, expect, test } from "bun:test";
import type { RuntimeRpc } from "../../src/background/runtime-rpc";
import type { WalletStatusReader } from "../../src/background/runtime-types";
import type { UnlockSession } from "../../src/background/session";
import { handleTokenOps, type TokenOpsDeps } from "../../src/background/token-ops";
import type { PriceService } from "../../src/starknet/prices";
import type { TokenMetadata } from "../../src/starknet/rpc";
import { createMemoryStore } from "../../src/storage/kv";
import { createPreferencesStore } from "../../src/storage/preferences-store";

const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const SPOOF_ADDRESS = "0x00000000000000000000000000000000000000000000000000000000deadbeef";
const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

const rpc = (metadata: TokenMetadata): RuntimeRpc => ({
  async estimateInvokeFee() {
    return { overallFee: "0", unit: "FRI" };
  },
  async getDeploymentStatus() {
    return true;
  },
  async getNftOwner() {
    return "0x1";
  },
  async getTokenBalances() {
    return [];
  },
  async getTokenMetadata() {
    return metadata;
  },
  async getTransactionStatuses() {
    return {};
  },
  async submitDeclareTransaction() {
    return { classHash: "0x1", transactionHash: "0x1" };
  },
  async submitAccountDeployment() {
    return { transactionHash: "0x7de" };
  },
  async submitErc20Transfer() {
    return {
      call: { calldata: [], contractAddress: ETH, entrypoint: "transfer" },
      transactionHash: "0x7ab",
    };
  },
  async submitInvokeTransaction() {
    return { calls: [], transactionHash: "0x7cd" };
  },
});

const makeDeps = (
  metadata: TokenMetadata,
): { deps: TokenOpsDeps; preferencesStore: ReturnType<typeof createPreferencesStore> } => {
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  const deps: TokenOpsDeps = {
    preferencesStore,
    prices: {} as unknown as PriceService,
    runtimeRpc: rpc(metadata),
    session: {} as unknown as UnlockSession,
    wallet: {} as unknown as WalletStatusReader,
  };
  return { deps, preferencesStore };
};

describe("wallet.addToken spam handling", () => {
  test("adds a genuine token without hiding it", async () => {
    const { deps, preferencesStore } = makeDeps({ decimals: 6, name: "USD Coin", symbol: "usdc" });

    const response = await handleTokenOps(deps, "wallet.addToken", {
      address: USDC,
      type: "wallet.addToken",
    });
    expect(response).toMatchObject({ ok: true });

    const prefs = await preferencesStore.read();
    expect(prefs.tokens.some((token) => token.address === USDC && token.symbol === "USDC")).toBe(
      true,
    );
    expect(prefs.hiddenTokens ?? []).not.toContain(`SN_MAIN:USDC:${USDC}`);
  });

  test("falls back to the symbol when on-chain metadata has a blank name", async () => {
    // buildTokenRecord uses the symbol as the display name when the trimmed
    // on-chain name is empty, so a token with whitespace-only metadata still
    // gets a usable label rather than a blank one.
    const { deps, preferencesStore } = makeDeps({ decimals: 6, name: "   ", symbol: "usdc" });

    const response = await handleTokenOps(deps, "wallet.addToken", {
      address: USDC,
      type: "wallet.addToken",
    });
    expect(response).toMatchObject({ ok: true });

    const prefs = await preferencesStore.read();
    const stored = prefs.tokens.find((token) => token.address === USDC);
    expect(stored?.name).toBe("USDC");
    expect(stored?.symbol).toBe("USDC");
  });

  test("adds a symbol-spoofing token but hides it by default", async () => {
    const { deps, preferencesStore } = makeDeps({
      decimals: 6,
      name: "Fake USD Coin",
      symbol: "usdc",
    });

    const response = await handleTokenOps(deps, "wallet.addToken", {
      address: SPOOF_ADDRESS,
      type: "wallet.addToken",
    });
    expect(response).toMatchObject({ ok: true });

    const prefs = await preferencesStore.read();
    const id = `SN_MAIN:USDC:${SPOOF_ADDRESS}`;
    expect(prefs.tokens.some((token) => token.id === id)).toBe(true);
    expect(prefs.hiddenTokens ?? []).toContain(id);
  });
});
