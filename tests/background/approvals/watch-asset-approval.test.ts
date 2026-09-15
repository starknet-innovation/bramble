/**
 * Watch-asset approval lifecycle: a dapp request fetches on-chain metadata and
 * queues an approval; approving tracks the token through the preferences store
 * and later requests resolve immediately; denying leaves the token untracked.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createApprovalQueue } from "../../../apps/extension/src/background/approvals/approvals";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { walletEventBroadcasts } from "../../../apps/extension/src/background/runtime/events";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";
import { flushHeld, latestApprovalId } from "../../support/held";

const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const DAI = "0x03e85bfbb8e2a42b7bead9e88e9a1b19dbccf661471061807292120462396ec9";
const origin = "https://dapp.example";

const account: AccountRef = {
  accountContractType: "openzeppelin",
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
  async getNftOwner() {
    return "0x1";
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
  async submitDeclareTransaction() {
    return { classHash: "0x1", transactionHash: "0x1" };
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
  const handler = createMessageHandler(walletStub, testExtension, {
    approvals,
    preferencesStore,
    runtimeRpc: { ...throwingRpc(), getTokenMetadata },
    session: createUnlockSession(),
  });
  return { handler, preferencesStore };
};

const usdcMetadata: RuntimeRpc["getTokenMetadata"] = async (input) => {
  metadataCalls.push({ address: input.address, rpcUrls: input.rpcUrls });
  return input.address === DAI
    ? { decimals: 18, name: "Dai Stablecoin", symbol: "DAI" }
    : { decimals: 6, name: "USD Coin", symbol: "USDC" };
};

const pendingId = (handler: ReturnType<typeof makeHandler>["handler"]): Promise<string> =>
  latestApprovalId(handler, extensionSender);

describe("watch-asset approval lifecycle", () => {
  test("bounds and deduplicates metadata before approval insertion", async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const { handler } = makeHandler(async (input) => {
      calls += 1;
      await blocked;
      return usdcMetadata(input);
    });

    const same = Array.from({ length: 8 }, () =>
      handler({ asset: { address: USDC }, origin, type: "wallet.watchAsset" }, contentSender),
    );
    await flushHeld();
    expect(calls).toBe(1);

    const distinct = [1, 2, 3, 4, 5, 6].map((index) =>
      handler(
        {
          asset: { address: `0x${index}`, decimals: 18, symbol: `T${index}` },
          origin,
          type: "wallet.watchAsset",
        },
        contentSender,
      ),
    );
    await flushHeld();
    expect(calls).toBe(5);
    await expect(distinct[4]).resolves.toEqual({ error: "wallet request failed" });
    await expect(distinct[5]).resolves.toEqual({ error: "wallet request failed" });

    release?.();
    await flushHeld();
    const pending = (await handler({ type: "wallet.pendingApprovals" }, extensionSender)) as {
      readonly pending: readonly { readonly id: string }[];
    };
    expect(pending.pending).toHaveLength(5);
    for (const approval of pending.pending) {
      await handler({ id: approval.id, type: "wallet.denyOrigin" }, extensionSender);
    }
    await Promise.all(same);
    await Promise.all(distinct.slice(0, 4));
  });

  test("queues a watch-asset prompt with on-chain metadata", async () => {
    metadataCalls.length = 0;
    const { handler } = makeHandler(usdcMetadata);

    // The request holds until a decision, so fire it without awaiting and read
    // the queued approval, then settle it so nothing is left pending.
    const held = handler(
      { asset: { address: USDC }, origin, type: "wallet.watchAsset" },
      contentSender,
    );
    await flushHeld();
    const listed = await handler({ type: "wallet.pendingApprovals" }, extensionSender);

    expect((listed as { pending: readonly unknown[] }).pending.at(-1)).toMatchObject({
      kind: "watch-asset",
      origin,
      token: {
        address: USDC,
        decimals: 6,
        name: "USD Coin",
        networkId: "SN_MAIN",
        symbol: "USDC",
      },
    });
    expect(metadataCalls).toHaveLength(1);
    expect(metadataCalls[0]?.address).toBe(USDC);
    expect(metadataCalls[0]?.rpcUrls.length).toBeGreaterThan(0);

    const id = await pendingId(handler);
    await handler({ id, type: "wallet.approveOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ ok: true, watched: true });
  });

  test("approving tracks the token and later requests resolve true", async () => {
    const { handler, preferencesStore } = makeHandler(usdcMetadata);

    const held = handler(
      { asset: { address: USDC }, origin, type: "wallet.watchAsset" },
      contentSender,
    );
    await flushHeld();
    const id = await pendingId(handler);

    await expect(handler({ id, type: "wallet.approveOrigin" }, extensionSender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
    await expect(held).resolves.toEqual({ ok: true, watched: true });
    const preferences = await preferencesStore.read();
    expect(
      preferences.tokens.some((token) => token.address === USDC && token.symbol === "USDC"),
    ).toBe(true);
    // The token is already tracked, so a repeat request resolves immediately.
    await expect(
      handler({ asset: { address: USDC }, origin, type: "wallet.watchAsset" }, contentSender),
    ).resolves.toEqual({ ok: true, watched: true });
  });

  test("denying leaves the token untracked", async () => {
    const { handler, preferencesStore } = makeHandler(usdcMetadata);

    const held = handler(
      { asset: { address: DAI }, origin, type: "wallet.watchAsset" },
      contentSender,
    );
    await flushHeld();
    const id = await pendingId(handler);

    await expect(handler({ id, type: "wallet.denyOrigin" }, extensionSender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
    await expect(held).resolves.toEqual({ error: "request rejected" });
    const preferences = await preferencesStore.read();
    expect(preferences.tokens.some((token) => token.address === DAI)).toBe(false);
    // A denied token is not tracked, so a repeat request queues a fresh prompt.
    const held2 = handler(
      { asset: { address: DAI }, origin, type: "wallet.watchAsset" },
      contentSender,
    );
    await flushHeld();
    const requeued = await handler({ type: "wallet.pendingApprovals" }, extensionSender);
    expect((requeued as { pending: readonly unknown[] }).pending.at(-1)).toMatchObject({
      kind: "watch-asset",
    });
    const id2 = await pendingId(handler);
    await handler({ id: id2, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held2).resolves.toEqual({ error: "request rejected" });
  });

  test("falls back to dapp options when on-chain metadata is unavailable", async () => {
    const { handler } = makeHandler(throwingRpc().getTokenMetadata);

    const held = handler(
      { asset: { address: DAI, decimals: 18, symbol: "DAI" }, origin, type: "wallet.watchAsset" },
      contentSender,
    );
    await flushHeld();
    const listed = await handler({ type: "wallet.pendingApprovals" }, extensionSender);
    expect((listed as { pending: readonly unknown[] }).pending.at(-1)).toMatchObject({
      token: { address: DAI, decimals: 18, name: "DAI", symbol: "DAI" },
    });
    const id = await pendingId(handler);
    await handler({ id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "request rejected" });
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

  test("does not broadcast from the watch-asset response itself", () => {
    // A held watch-asset request signals the queue at enqueue time through the
    // approval notifier; the request's own settled response broadcasts nothing.
    expect(
      walletEventBroadcasts({ type: "wallet.watchAsset" }, { ok: true, watched: true }),
    ).toEqual([]);
    // Approving the queued prompt is what refreshes the approvals list.
    expect(
      walletEventBroadcasts({ type: "wallet.approveOrigin" }, { ok: true, pending: [] }),
    ).toEqual([
      { event: "accountsChanged", type: "wallet.event" },
      { event: "approvalsChanged", type: "wallet.event" },
    ]);
  });
});
