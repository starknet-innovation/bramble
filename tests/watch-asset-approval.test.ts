/**
 * Watch-asset approval lifecycle: a dapp request fetches on-chain metadata and
 * queues an approval; approving tracks the token through the preferences store
 * and later requests resolve immediately; denying leaves the token untracked.
 */
import { describe, expect, test } from "bun:test";
import { createApprovalQueue } from "../src/background/approvals";
import { walletEventBroadcasts } from "../src/background/events";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeRpc } from "../src/background/runtime-rpc";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import { createMemoryStore } from "../src/storage/kv";
import { createPreferencesStore } from "../src/storage/preferences-store";
import type { AccountRef } from "../src/storage/vault-schema";

const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const DAI = "0x03e85bfbb8e2a42b7bead9e88e9a1b19dbccf661471061807292120462396ec9";
const origin = "https://dapp.example";

const account: AccountRef = {
  address: "0xabcabcdef",
  classHash: "0xabcdef",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0xabcabcdef",
  networkId: "SN_MAIN",
  publicKeyX: "0xabc",
  publicKeyY: "0xdef",
};

const contentSender: RuntimeSender = { id: "extension-id", url: `${origin}/app` };
const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

const walletStub = {
  async createAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts() {
    return [] as readonly AccountRef[];
  },
  async generateMnemonic() {
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
  },
  async grantOrigin() {
    return [account];
  },
  async readVault() {
    throw new Error("unused");
  },
  async setActiveAccount() {
    return account;
  },
  async signHash() {
    return { publicKey: "0xabc", r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: account.id,
      hasVault: true,
      locked: true,
      ready: true,
    };
  },
};

const metadataCalls: { address: string; rpcUrls: readonly string[] }[] = [];

const throwingRpc = (): RuntimeRpc => ({
  async estimateInvokeFee() {
    throw new Error("unused");
  },
  async getDeploymentStatus() {
    return true;
  },
  async getTokenBalances() {
    return [];
  },
  async getTokenMetadata() {
    throw new Error("unused");
  },
  async getTransactionStatuses() {
    return {};
  },
  async submitAccountDeployment() {
    throw new Error("unused");
  },
  async submitErc20Transfer() {
    throw new Error("unused");
  },
  async submitInvokeTransaction() {
    throw new Error("unused");
  },
});

const makeHandler = (getTokenMetadata: RuntimeRpc["getTokenMetadata"]) => {
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  const approvals = createApprovalQueue();
  const handler = createMessageHandler(
    walletStub,
    "extension-id",
    createUnlockSession(),
    approvals,
    preferencesStore,
    { ...throwingRpc(), getTokenMetadata },
  );
  return { handler, preferencesStore };
};

const usdcMetadata: RuntimeRpc["getTokenMetadata"] = async (input) => {
  metadataCalls.push({ address: input.address, rpcUrls: input.rpcUrls });
  return input.address === DAI
    ? { decimals: 18, name: "Dai Stablecoin", symbol: "DAI" }
    : { decimals: 6, name: "USD Coin", symbol: "USDC" };
};

const pendingId = async (handler: ReturnType<typeof makeHandler>["handler"]): Promise<string> => {
  const response = await handler({ type: "wallet.pendingApprovals" }, extensionSender);
  const pending = (response as { pending: readonly { id: string }[] }).pending;
  const id = pending.at(-1)?.id;
  if (!id) {
    throw new Error("no pending approval");
  }
  return id;
};

describe("watch-asset approval lifecycle", () => {
  test("queues a watch-asset prompt with on-chain metadata", async () => {
    metadataCalls.length = 0;
    const { handler } = makeHandler(usdcMetadata);

    const response = await handler(
      { asset: { address: USDC }, origin, type: "wallet.watchAsset" },
      contentSender,
    );

    expect(response).toMatchObject({
      ok: false,
      pending: {
        kind: "watch-asset",
        origin,
        token: {
          address: USDC,
          decimals: 6,
          name: "USD Coin",
          networkId: "SN_MAIN",
          symbol: "USDC",
        },
      },
    });
    expect(metadataCalls).toHaveLength(1);
    expect(metadataCalls[0]?.address).toBe(USDC);
    expect(metadataCalls[0]?.rpcUrls.length).toBeGreaterThan(0);
  });

  test("approving tracks the token and later requests resolve true", async () => {
    const { handler, preferencesStore } = makeHandler(usdcMetadata);

    await handler({ asset: { address: USDC }, origin, type: "wallet.watchAsset" }, contentSender);
    const id = await pendingId(handler);

    await expect(handler({ id, type: "wallet.approveOrigin" }, extensionSender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
    const preferences = await preferencesStore.read();
    expect(
      preferences.tokens.some((token) => token.address === USDC && token.symbol === "USDC"),
    ).toBe(true);
    await expect(
      handler({ asset: { address: USDC }, origin, type: "wallet.watchAsset" }, contentSender),
    ).resolves.toEqual({ ok: true, watched: true });
  });

  test("denying leaves the token untracked", async () => {
    const { handler, preferencesStore } = makeHandler(usdcMetadata);

    await handler({ asset: { address: DAI }, origin, type: "wallet.watchAsset" }, contentSender);
    const id = await pendingId(handler);

    await expect(handler({ id, type: "wallet.denyOrigin" }, extensionSender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
    const preferences = await preferencesStore.read();
    expect(preferences.tokens.some((token) => token.address === DAI)).toBe(false);
    await expect(
      handler({ asset: { address: DAI }, origin, type: "wallet.watchAsset" }, contentSender),
    ).resolves.toMatchObject({ ok: false, pending: { kind: "watch-asset" } });
  });

  test("falls back to dapp options when on-chain metadata is unavailable", async () => {
    const { handler } = makeHandler(throwingRpc().getTokenMetadata);

    await expect(
      handler(
        { asset: { address: DAI, decimals: 18, symbol: "DAI" }, origin, type: "wallet.watchAsset" },
        contentSender,
      ),
    ).resolves.toMatchObject({
      ok: false,
      pending: { token: { address: DAI, decimals: 18, name: "DAI", symbol: "DAI" } },
    });
  });

  test("rejects unusable metadata and origin mismatches", async () => {
    const { handler } = makeHandler(throwingRpc().getTokenMetadata);

    await expect(
      handler({ asset: { address: DAI }, origin, type: "wallet.watchAsset" }, contentSender),
    ).resolves.toEqual({ error: "invalid watch asset metadata" });
    await expect(
      handler(
        { asset: { address: USDC }, origin: "https://evil.example", type: "wallet.watchAsset" },
        contentSender,
      ),
    ).resolves.toEqual({ error: "sender origin mismatch" });
  });

  test("broadcasts approvalsChanged only when a prompt is queued", () => {
    expect(
      walletEventBroadcasts(
        { type: "wallet.watchAsset" },
        { ok: false, pending: { id: "x", kind: "watch-asset", origin } },
      ),
    ).toEqual([{ event: "approvalsChanged", type: "wallet.event" }]);
    expect(
      walletEventBroadcasts({ type: "wallet.watchAsset" }, { ok: true, watched: true }),
    ).toEqual([]);
  });
});
