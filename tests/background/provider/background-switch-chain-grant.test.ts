/**
 * switchChain grant gate (A-M1): a dapp may steer the wallet's active network
 * only when its origin already holds a connection grant. Unconnected sites and
 * a locked wallet are rejected instead of switching the chain for everyone —
 * and the grant is re-checked when the queued card is approved, so a stale
 * switch prompt can never reconnect an origin the user has disconnected.
 */
import { describe, expect, test } from "bun:test";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";
import { flushHeld, latestApprovalId } from "../../support/held";

const MAINNET_CHAIN_ID = "0x534e5f4d41494e";
const origin = "https://dapp.example";
const vaultPassphrase = "correct horse battery staple";
const contentSender: RuntimeSender = { id: "extension-id", url: `${origin}/app` };
const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

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

// `connected` is read on every call so a test can disconnect the origin
// between queueing the switch prompt and approving it; `grants` records any
// grant the applier makes, which must stay empty: a switch never grants.
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
      accountSecrets: [],
      activeAccountId: account.id,
      importedSeeds: [],
      mnemonic: null,
      originGrants: [{ accountIds: [account.id], origin }],
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

const switchMessage = { chainId: MAINNET_CHAIN_ID, origin, type: "wallet.switchChain" as const };

describe("switchChain grant gate (A-M1)", () => {
  test("lets a connected origin switch the active network after approval", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    let coordinatedMutations = 0;
    const handler = createMessageHandler(
      walletStub(() => [account]),
      testExtension,
      {
        activeStateCoordinator: {
          run: async (operation) => {
            coordinatedMutations += 1;
            return operation();
          },
        },
        session,
      },
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
    expect(coordinatedMutations).toBe(1);
  });

  test("rejects a switch from an origin with no grant", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(
      walletStub(() => []),
      testExtension,
      { session },
    );

    await expect(handler(switchMessage, contentSender)).resolves.toEqual({
      error: "origin not connected",
    });
  });

  test("rejects a switch while the wallet is locked", async () => {
    const handler = createMessageHandler(
      walletStub(() => [account]),
      testExtension,
      { session: createUnlockSession() },
    );

    await expect(handler(switchMessage, contentSender)).resolves.toEqual({
      error: "origin not connected",
    });
  });

  test("never grants the landed account the origin was not connected to (audit 124)", async () => {
    // The origin holds only a Sepolia account; the switch lands on the vault's
    // Mainnet account, which the user never connected. The card names no
    // account, so approving it must not share one: no grant, and the standard
    // reconnect prompt (which does name the account) is queued instead.
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const sepolia: AccountRef = {
      ...account,
      address: "0x9999",
      id: "SN_SEPOLIA:0x9999",
      networkId: "SN_SEPOLIA",
    };
    const grants: string[] = [];
    const handler = createMessageHandler(
      walletStub(() => [sepolia], grants),
      testExtension,
      { session },
    );

    const held = handler(switchMessage, contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);
    const approved = (await handler({ id, type: "wallet.approveOrigin" }, extensionSender)) as {
      readonly pending: readonly {
        readonly existingGrant?: boolean;
        readonly kind: string;
        readonly origin: string;
      }[];
    };
    await expect(held).resolves.toEqual({ chainId: MAINNET_CHAIN_ID, ok: true });
    expect(grants).toEqual([]);
    expect(approved.pending).toEqual([
      expect.objectContaining({ existingGrant: true, kind: "connect", origin }),
    ]);
  });

  test("does not grant an account the switch had to derive on the target network", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const sepolia: AccountRef = {
      ...account,
      address: "0x9999",
      id: "SN_SEPOLIA:0x9999",
      networkId: "SN_SEPOLIA",
    };
    const grants: string[] = [];
    let derived = 0;
    const stub = walletStub(() => [sepolia], grants);
    const handler = createMessageHandler(
      {
        ...stub,
        async ensureNetworkAccount() {
          derived += 1;
          return account;
        },
        async readVault() {
          const vault = await stub.readVault();
          return { ...vault, accounts: [sepolia], activeAccountId: sepolia.id };
        },
      },
      testExtension,
      { session },
    );

    const held = handler(switchMessage, contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);
    await handler({ id, type: "wallet.approveOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ chainId: MAINNET_CHAIN_ID, ok: true });
    expect(derived).toBe(1);
    expect(grants).toEqual([]);
  });

  test("lands on the account the origin already holds on the target network", async () => {
    // Granted on both networks: the switch selects the origin's granted Mainnet
    // account rather than the vault's first Mainnet account, and grants nothing.
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const sepolia: AccountRef = {
      ...account,
      address: "0x9999",
      id: "SN_SEPOLIA:0x9999",
      networkId: "SN_SEPOLIA",
    };
    const grantedMainnet: AccountRef = { ...account, address: "0x7777", id: "SN_MAIN:0x7777" };
    const grants: string[] = [];
    const selected: string[] = [];
    const stub = walletStub(() => [sepolia, grantedMainnet], grants);
    const handler = createMessageHandler(
      {
        ...stub,
        async readVault() {
          const vault = await stub.readVault();
          return {
            ...vault,
            accounts: [sepolia, account, grantedMainnet],
            activeAccountId: sepolia.id,
          };
        },
        async setActiveAccount(input: { readonly accountId: string }) {
          selected.push(input.accountId);
          return input.accountId === grantedMainnet.id ? grantedMainnet : account;
        },
      },
      testExtension,
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
    expect(selected).toEqual([grantedMainnet.id]);
    expect(grants).toEqual([]);
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
      testExtension,
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
