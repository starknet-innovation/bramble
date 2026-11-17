/**
 * wallet.addToken now runs the full spam heuristics: a spoofed token is still
 * added but hidden by default, while a genuine token stays visible (A-L10).
 */
import { describe, expect, test } from "bun:test";
import type { PriceService } from "@bramble/portfolio/prices";
import { createPreferencesStore } from "@bramble/settings/preferences";
import type { TokenMetadata } from "@bramble/starknet/rpc";
import { createMemoryStore } from "@bramble/store/kv";
import { verificationContext } from "@bramble/transactions/verify";
import type { WalletStatusReader } from "../../../apps/extension/src/background/accounts/wallet-reader";
import {
  handleTokenOps,
  type TokenOpsDeps,
} from "../../../apps/extension/src/background/portfolio/token-ops";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import type { UnlockSession } from "../../../apps/extension/src/background/runtime/session";

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

  test("falls back to the symbol when metadata carries Unicode spoofing", async () => {
    const { deps, preferencesStore } = makeDeps({
      decimals: 6,
      name: "USD‮⁦Coin",
      symbol: "usdc",
    });

    await handleTokenOps(deps, "wallet.addToken", {
      address: USDC,
      type: "wallet.addToken",
    });

    const stored = (await preferencesStore.read()).tokens.find((token) => token.address === USDC);
    expect(stored?.name).toBe("USDC");
  });

  test("a user add clears the dapp mark, so the reviewer trusts the token (audit 171)", async () => {
    const PLAIN = "0x0777000000000000000000000000000000000000000000000000000000000002";
    const { deps, preferencesStore } = makeDeps({ decimals: 6, name: "Plain", symbol: "plain" });
    const record = {
      address: PLAIN,
      decimals: 6,
      name: "Plain",
      networkId: "SN_MAIN",
      symbol: "PLAIN",
    } as const;
    await preferencesStore.upsertToken(record, "dapp");
    const before = await preferencesStore.read();
    expect(
      verificationContext({ address: "0x1", networkId: "SN_MAIN" }, before).tokens,
    ).not.toContainEqual(expect.objectContaining({ address: PLAIN }));

    await handleTokenOps(deps, "wallet.addToken", { address: PLAIN, type: "wallet.addToken" });

    const after = await preferencesStore.read();
    expect(after.dappTokenIds).toEqual([]);
    expect(
      verificationContext({ address: "0x1", networkId: "SN_MAIN" }, after).tokens,
    ).toContainEqual(expect.objectContaining({ address: PLAIN, symbol: "PLAIN" }));
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
