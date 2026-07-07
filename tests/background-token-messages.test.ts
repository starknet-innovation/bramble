/**
 * Background token message checks: custom-token add via on-chain metadata,
 * curated auto-detection, spam hide/reveal, fiat prices, and price charts,
 * all gated to extension-page senders.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import type { PriceService } from "../src/starknet/prices";
import type { TokenMetadata } from "../src/starknet/rpc";
import { createMemoryStore } from "../src/storage/kv";
import { createPreferencesStore } from "../src/storage/preferences-store";
import type { AccountRef, Vault } from "../src/storage/vault-schema";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
const vaultPassphrase = "correct horse battery staple";
const sender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const contentSender: RuntimeSender = { id: "extension-id", url: "https://example.com/app" };

const walletStub = {
  async addDerivedAccount() {
    return account;
  },
  async createAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts() {
    return [account];
  },
  async generateMnemonic() {
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
  },
  async grantOrigin() {
    return [account];
  },
  async readVault() {
    return vault;
  },
  async setActiveAccount() {
    return account;
  },
  async signHash() {
    return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      ready: false,
    };
  },
};

const prices: PriceService = {
  async getPrices({ addresses, currency }) {
    return { currency, prices: Object.fromEntries(addresses.map((address) => [address, 2])) };
  },
  async getTokenChart({ currency }) {
    return { currency, points: [1, 2, 3] };
  },
};

const makeHandler = (
  metadata: TokenMetadata = { decimals: 6, name: "USD Coin", symbol: "usdc" },
) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  const handler = createMessageHandler(
    walletStub,
    "extension-id",
    session,
    undefined,
    preferencesStore,
    {
      async estimateInvokeFee() {
        return { overallFee: "0", unit: "FRI" };
      },
      async getDeploymentStatus() {
        return true;
      },
      async getNftOwner() {
        return "0x1";
      },
      async getTokenBalances({ tokens }) {
        return tokens.map((token, index) => ({
          ...token,
          balance: index === 0 ? "1000000" : "0",
          formatted: index === 0 ? "1.0" : "0",
        }));
      },
      async getTokenMetadata() {
        return metadata;
      },
      async getTransactionStatuses() {
        return {};
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
    },
    undefined,
    undefined,
    prices,
  );
  return { handler, preferencesStore };
};

describe("background token messages", () => {
  test("adds a custom token from decoded on-chain metadata", async () => {
    const { handler, preferencesStore } = makeHandler();

    const response = await handler({ address: USDC, type: "wallet.addToken" }, sender);
    expect(response).toMatchObject({ ok: true });

    const stored = await preferencesStore.read();
    expect(stored.tokens.some((token) => token.symbol === "USDC" && token.address === USDC)).toBe(
      true,
    );
  });

  test("rejects tokens whose symbol is not a plausible ticker", async () => {
    const { handler } = makeHandler({ decimals: 18, name: "Weird", symbol: "!!" });

    await expect(handler({ address: USDC, type: "wallet.addToken" }, sender)).resolves.toEqual({
      error: "unsupported token symbol",
    });
  });

  test("detects held registry tokens not already tracked", async () => {
    const { handler } = makeHandler();

    const response = await handler({ type: "wallet.detectTokens" }, sender);
    expect(response).toMatchObject({ ok: true });
    const suggestions = (response as { suggestions: readonly { symbol: string }[] }).suggestions;
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.symbol).toBe("USDC");
  });

  test("hides and reveals a tracked token", async () => {
    const { handler, preferencesStore } = makeHandler();
    const tokenId = (await preferencesStore.read()).tokens.find(
      (token) => token.symbol === "ETH" && token.networkId === "SN_MAIN",
    )?.id;
    expect(tokenId).toBeString();

    await handler({ hidden: true, tokenId, type: "wallet.setTokenHidden" }, sender);
    expect((await preferencesStore.read()).hiddenTokens).toContain(tokenId ?? "");

    await handler({ hidden: false, tokenId, type: "wallet.setTokenHidden" }, sender);
    expect((await preferencesStore.read()).hiddenTokens ?? []).not.toContain(tokenId ?? "");
  });

  test("returns fiat prices for tracked tokens in the display currency", async () => {
    const { handler } = makeHandler();

    const response = await handler({ type: "wallet.prices" }, sender);
    expect(response).toMatchObject({ currency: "usd", ok: true });
    expect((response as { prices: Record<string, number> }).prices[ETH]).toBe(2);
  });

  test("returns a token price chart", async () => {
    const { handler } = makeHandler();

    await expect(handler({ address: USDC, type: "wallet.tokenChart" }, sender)).resolves.toEqual({
      currency: "usd",
      ok: true,
      points: [1, 2, 3],
    });
  });

  test("rejects token commands from content senders", async () => {
    const { handler } = makeHandler();

    await expect(
      handler({ address: USDC, type: "wallet.addToken" }, contentSender),
    ).resolves.toEqual({ error: "privileged sender required" });
  });
});
