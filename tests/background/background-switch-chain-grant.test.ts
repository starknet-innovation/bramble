/**
 * switchChain grant gate (A-M1): a dapp may steer the wallet's active network
 * only when its origin already holds a connection grant. Unconnected sites and
 * a locked wallet are rejected instead of switching the chain for everyone —
 * and the grant is re-checked when the queued card is approved, so a stale
 * switch prompt can never reconnect an origin the user has disconnected.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../../src/background/messages";
import type { RuntimeSender } from "../../src/background/senders";
import { createUnlockSession } from "../../src/background/session";
import type { AccountRef } from "../../src/storage/vault-schema";
import { flushHeld, latestApprovalId } from "../support/held";

const MAINNET_CHAIN_ID = "0x534e5f4d41494e";
const origin = "https://dapp.example";
const vaultPassphrase = "correct horse battery staple";
const contentSender: RuntimeSender = { id: "extension-id", url: `${origin}/app` };
const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

// `connected` is read on every call so a test can disconnect the origin
// between queueing the switch prompt and approving it; `grants` records the
// auto-grant the applier makes for the account the switch lands on.
const walletStub = (connected: () => readonly AccountRef[], grants: string[] = []) => ({
  async addDerivedAccount() {
    return account;
  },
  async createAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts(target: string) {
    return target === origin ? connected() : [];
  },
  async generateMnemonic() {
    return "unused";
  },
  async grantOrigin(input: { readonly accountId?: string }) {
    grants.push(input.accountId ?? account.id);
    return connected();
  },
  async readVault() {
    return {
      accounts: [account],
      activeAccountId: account.id,
      mnemonic: null,
      originGrants: [{ accountIds: [account.id], origin }],
      schemaVersion: 3 as const,
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

const switchMessage = { chainId: MAINNET_CHAIN_ID, origin, type: "wallet.switchChain" as const };

describe("switchChain grant gate (A-M1)", () => {
  test("lets a connected origin switch the active network after approval", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(
      walletStub(() => [account]),
      "extension-id",
      { session },
    );

    // The switch is held behind an explicit approval — it never changes the
    // network just because a connected site asked.
    const held = handler(switchMessage, contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);
    await expect(handler({ id, type: "wallet.approveOrigin" }, extensionSender)).resolves.toEqual({
      chainId: MAINNET_CHAIN_ID,
      ok: true,
      pending: [],
    });
    await expect(held).resolves.toEqual({ chainId: MAINNET_CHAIN_ID, ok: true });
  });

  test("rejects a switch from an origin with no grant", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(
      walletStub(() => []),
      "extension-id",
      { session },
    );

    await expect(handler(switchMessage, contentSender)).resolves.toEqual({
      error: "origin not connected",
    });
  });

  test("rejects a switch while the wallet is locked", async () => {
    const handler = createMessageHandler(
      walletStub(() => [account]),
      "extension-id",
      { session: createUnlockSession() },
    );

    await expect(handler(switchMessage, contentSender)).resolves.toEqual({
      error: "origin not connected",
    });
  });

  test("grants the landed network's account when the origin is still connected", async () => {
    // The origin is connected through a different account than the one the
    // switch lands on, so the applier tops the grant up with the new account —
    // the connection survives the network change.
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const other: AccountRef = { ...account, address: "0x9999", id: "SN_MAIN:0x9999" };
    const grants: string[] = [];
    const handler = createMessageHandler(
      walletStub(() => [other], grants),
      "extension-id",
      { session },
    );

    const held = handler(switchMessage, contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);
    await expect(handler({ id, type: "wallet.approveOrigin" }, extensionSender)).resolves.toEqual({
      chainId: MAINNET_CHAIN_ID,
      ok: true,
      pending: [],
    });
    await expect(held).resolves.toEqual({ chainId: MAINNET_CHAIN_ID, ok: true });
    expect(grants).toEqual([account.id]);
  });

  test("refuses a stale switch card once the origin has been disconnected", async () => {
    // Queue the prompt while connected, then switch to an account the grant
    // does not cover — the origin now reads as disconnected. Approving the
    // stale card must not silently re-grant it the new network's account and
    // reconnect it behind the user's back.
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const grants: string[] = [];
    let connected: readonly AccountRef[] = [account];
    const handler = createMessageHandler(
      walletStub(() => connected, grants),
      "extension-id",
      { session },
    );

    const held = handler(switchMessage, contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);
    connected = [];

    await expect(handler({ id, type: "wallet.approveOrigin" }, extensionSender)).resolves.toEqual({
      error: "origin not connected",
    });
    await expect(held).resolves.toEqual({ error: "origin not connected" });
    expect(grants).toEqual([]);
  });
});
