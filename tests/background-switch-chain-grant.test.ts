/**
 * switchChain grant gate (A-M1): a dapp may steer the wallet's active network
 * only when its origin already holds a connection grant. Unconnected sites and
 * a locked wallet are rejected instead of switching the chain for everyone.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import type { AccountRef } from "../src/storage/vault-schema";
import { flushHeld, latestApprovalId } from "./support/held";

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

const walletStub = (connected: readonly AccountRef[]) => ({
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
    return target === origin ? connected : [];
  },
  async generateMnemonic() {
    return "unused";
  },
  async grantOrigin() {
    return connected;
  },
  async readVault() {
    return {
      accounts: [account],
      activeAccountId: account.id,
      mnemonic: null,
      originGrants: [{ accountIds: [account.id], origin }],
      schemaVersion: 2 as const,
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
    const handler = createMessageHandler(walletStub([account]), "extension-id", session);

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
    const handler = createMessageHandler(walletStub([]), "extension-id", session);

    await expect(handler(switchMessage, contentSender)).resolves.toEqual({
      error: "origin not connected",
    });
  });

  test("rejects a switch while the wallet is locked", async () => {
    const handler = createMessageHandler(
      walletStub([account]),
      "extension-id",
      createUnlockSession(),
    );

    await expect(handler(switchMessage, contentSender)).resolves.toEqual({
      error: "origin not connected",
    });
  });
});
