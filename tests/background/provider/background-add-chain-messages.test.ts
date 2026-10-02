/**
 * wallet_addStarknetChain held-approval gate: a custom chain is never persisted
 * without an explicit user approval. The request is queued as an "add-chain"
 * approval and held; it persists only on approve, is dropped on deny (mapping to
 * USER_REFUSED_OP on the wire), and an already-listed chain returns true with no
 * prompt.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createApprovalQueue } from "../../../apps/extension/src/background/approvals/approvals";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";
import { flushHeld, latestApprovalId } from "../../support/held";

const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const origin = "https://dapp.example";
const contentSender: RuntimeSender = { id: "extension-id", url: `${origin}/app` };
const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

const chain = {
  chainId: "0x534e5f4b4154414e41",
  chainName: "Katana",
  id: "katana",
  rpcUrls: ["https://rpc.katana.example"] as const,
};

const walletStub = () => ({
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
    return [];
  },
  async generateMnemonic() {
    return "unused";
  },
  async grantOrigin() {
    return [];
  },
  async readVault() {
    return {
      accounts: [account],
      accountSecrets: [],
      activeAccountId: account.id,
      importedSeeds: [],
      mnemonic: null,
      originGrants: [],
      schemaVersion: 10 as const,
      signingKeys: [{ accountId: account.id, privateKey: "0x123456" }],
    };
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
      ready: true,
    };
  },
});

const makeHarness = () => {
  const session = createUnlockSession();
  const approvals = createApprovalQueue();
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  const handler = createMessageHandler(walletStub(), testExtension, {
    approvals,
    preferencesStore,
    session,
  });
  return { handler, preferencesStore };
};

const addChainMessage = (overrides: Record<string, unknown> = {}) => ({
  chain: { ...chain, ...overrides },
  origin,
  type: "wallet.addStarknetChain" as const,
});

describe("wallet_addStarknetChain held approval", () => {
  test("queues an add-chain approval without persisting", async () => {
    const { handler, preferencesStore } = makeHarness();

    const held = handler(addChainMessage(), contentSender);
    await flushHeld();
    const listed = await handler({ type: "wallet.pendingApprovals" }, extensionSender);
    const pending = (
      listed as {
        pending: readonly { kind?: string; origin?: string; summaries?: readonly string[] }[];
      }
    ).pending.at(-1);
    expect(pending).toMatchObject({ kind: "add-chain", origin });
    expect(pending?.summaries).toContain("Katana");
    expect((await preferencesStore.read()).customNetworks ?? []).toHaveLength(0);

    const id = await latestApprovalId(handler, extensionSender);
    await handler({ id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "request rejected" });
  });

  test("persists the chain only after the user approves", async () => {
    const { handler, preferencesStore } = makeHarness();

    const held = handler(addChainMessage(), contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);

    await expect(handler({ id, type: "wallet.approveOrigin" }, extensionSender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
    await expect(held).resolves.toEqual({ added: true, ok: true });
    const stored = (await preferencesStore.read()).customNetworks ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.chainId).toBe(chain.chainId);
  });

  test("drops the chain when the user denies", async () => {
    const { handler, preferencesStore } = makeHarness();

    const held = handler(addChainMessage(), contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);

    await handler({ id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "request rejected" });
    expect((await preferencesStore.read()).customNetworks ?? []).toHaveLength(0);
  });

  test("returns true without a prompt for an already-listed chain", async () => {
    const { handler, preferencesStore } = makeHarness();

    // SN_MAIN's built-in chain id is already listed.
    await expect(
      handler(addChainMessage({ chainId: "0x534e5f4d41494e" }), contentSender),
    ).resolves.toEqual({ added: true, ok: true });
    const listed = await handler({ type: "wallet.pendingApprovals" }, extensionSender);
    expect((listed as { pending: readonly unknown[] }).pending).toHaveLength(0);
    expect((await preferencesStore.read()).customNetworks ?? []).toHaveLength(0);
  });

  test("rejects an oversized chain label crossed on a runtime message", async () => {
    // MCW-V09-130: the background re-validation once measured the trimmed label,
    // so a megabytes-long padded name passed `isProviderChain` and reached the
    // preferences store on approval. The bound is on the raw string now.
    const { handler, preferencesStore } = makeHarness();

    await expect(
      handler(addChainMessage({ chainName: `${" ".repeat(10_000_000)}a` }), contentSender),
    ).resolves.toEqual({ error: "invalid add chain request" });
    expect((await preferencesStore.read()).customNetworks ?? []).toHaveLength(0);
  });

  test("persists a padded chain label in its canonical trimmed form", async () => {
    const { handler, preferencesStore } = makeHarness();

    const held = handler(
      addChainMessage({ chainName: "  Katana  ", id: "  katana  " }),
      contentSender,
    );
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);
    await handler({ id, type: "wallet.approveOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ added: true, ok: true });

    const stored = (await preferencesStore.read()).customNetworks ?? [];
    expect(stored[0]).toMatchObject({ id: "katana", name: "Katana" });
  });

  test("refuses an oversized URL list before any approval is queued", async () => {
    // Sherlock audit 153: 80 RPC URLs of about 2 KB each, nearly the whole
    // 1 MiB preferences budget in one card.
    const { handler, preferencesStore } = makeHarness();
    const rpcUrls = Array.from(
      { length: 80 },
      (_, index) => `https://rpc.example/${index}/${"a".repeat(2000)}`,
    );
    const response = handler(addChainMessage({ rpcUrls }), contentSender);
    await flushHeld();
    const listed = await handler({ type: "wallet.pendingApprovals" }, extensionSender);
    expect((listed as { pending: readonly unknown[] }).pending).toHaveLength(0);
    await expect(response).resolves.toEqual({ error: "invalid add chain request" });
    expect((await preferencesStore.read()).customNetworks ?? []).toHaveLength(0);
  });

  test("an approved chain stores one RPC URL and no explorer or icon lists", async () => {
    const { handler, preferencesStore } = makeHarness();
    const held = handler(
      addChainMessage({
        blockExplorerUrls: ["https://explorer.katana.example"],
        iconUrls: ["https://icons.katana.example/a.png", "https://icons.katana.example/b.png"],
        rpcUrls: ["https://rpc.katana.example", "https://rpc2.katana.example"],
      }),
      contentSender,
    );
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);
    await handler({ id, type: "wallet.approveOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ added: true, ok: true });

    expect((await preferencesStore.read()).customNetworks).toEqual([
      {
        chainId: chain.chainId,
        id: "katana",
        name: "Katana",
        rpcUrls: ["https://rpc.katana.example"],
      },
    ]);
  });

  test("rejects a malformed chain payload", async () => {
    const { handler } = makeHarness();
    await expect(handler(addChainMessage({ chainId: "not-hex" }), contentSender)).resolves.toEqual({
      error: "invalid add chain request",
    });
  });

  test("rejects an add-chain from a blocklisted origin", async () => {
    const { handler } = makeHarness();
    const blockedOrigin = "https://starknet-airdrop.com";
    await expect(
      handler(
        { chain, origin: blockedOrigin, type: "wallet.addStarknetChain" },
        { id: "extension-id", url: `${blockedOrigin}/app` },
      ),
    ).resolves.toEqual({ error: "origin blocked" });
  });
});
