/**
 * switchChain grant gate (A-M1): a dapp may steer the wallet's active network
 * only when its origin already holds a connection grant. Unconnected sites and
 * a locked wallet are rejected instead of switching the chain for everyone —
 * and the grant is re-checked when the queued card is approved, so a stale
 * switch prompt can never reconnect an origin the user has disconnected.
 */
import { describe, expect, test } from "bun:test";
import { grantedAccountIdsFor } from "@bramble/vault/origin-grants";
import type { Vault } from "@bramble/vault/schema";
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

const sepolia: AccountRef = {
  ...account,
  address: "0x9999",
  id: "SN_SEPOLIA:0x9999",
  networkId: "SN_SEPOLIA",
};

// A stateful vault that answers getGrantedAccounts through the real
// active-account-only policy, so a test cannot pass on a grant list the vault
// could never return. `grants` and `derived` record writes; the switch must
// never grant. `otherGrants` are stored grants held by other origins.
const vaultWallet = (input: {
  readonly accounts: readonly AccountRef[];
  readonly active: string;
  readonly grant: readonly string[];
  readonly otherGrants?: Vault["originGrants"];
}) => {
  let accounts = [...input.accounts];
  let active = input.active;
  const grants: string[] = [];
  const derived: string[] = [];
  const snapshot = (): Vault => ({
    accounts,
    accountSecrets: [],
    activeAccountId: active,
    importedSeeds: [],
    mnemonic: null,
    originGrants: [...(input.otherGrants ?? []), { accountIds: [...input.grant], origin }],
    schemaVersion: 10,
    signingKeys: [],
  });
  const wallet = {
    ...walletStub(() => []),
    async ensureNetworkAccount() {
      accounts = [...accounts, account];
      derived.push(account.id);
      active = account.id;
      return account;
    },
    async getGrantedAccounts(target: string) {
      const current = snapshot();
      return grantedAccountIdsFor(current, target).flatMap((id) =>
        current.accounts.filter((stored) => stored.id === id),
      );
    },
    async grantOrigin(grant: { readonly accountId?: string }) {
      grants.push(grant.accountId ?? active);
      return [];
    },
    async readVault() {
      return snapshot();
    },
    async setActiveAccount(selection: { readonly accountId: string }) {
      active = selection.accountId;
      return accounts.find((stored) => stored.id === active) ?? account;
    },
  };
  return { activeId: () => active, derived, grants, wallet };
};

type ApprovedSwitch = {
  readonly chainId?: string;
  readonly ok?: boolean;
  readonly pending: readonly {
    readonly existingGrant?: boolean;
    readonly kind: string;
    readonly origin: string;
  }[];
};

// Queues a Mainnet switch from the dapp, approves it in the panel, and reads
// what the page can see afterwards without another prompt.
const approveSwitch = async (wallet: ReturnType<typeof vaultWallet>["wallet"]) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const handler = createMessageHandler(wallet, testExtension, { session });
  const held = handler(switchMessage, contentSender);
  await flushHeld();
  const id = await latestApprovalId(handler, extensionSender);
  const approved = (await handler(
    { id, type: "wallet.approveOrigin" },
    extensionSender,
  )) as ApprovedSwitch;
  const visible = (
    (await handler({ origin, type: "wallet.getGrantedAccounts" }, contentSender)) as {
      readonly accounts: readonly AccountRef[];
    }
  ).accounts;
  return { approved, held, visible };
};

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
    const vault = vaultWallet({
      accounts: [sepolia, account],
      active: sepolia.id,
      grant: [sepolia.id],
    });
    const { approved, held, visible } = await approveSwitch(vault.wallet);
    await expect(held).resolves.toEqual({ chainId: MAINNET_CHAIN_ID, ok: true });
    expect(vault.grants).toEqual([]);
    expect(vault.activeId()).toBe(account.id);
    expect(visible).toEqual([]);
    expect(approved.pending).toEqual([
      expect.objectContaining({ existingGrant: true, kind: "connect", origin }),
    ]);
  });

  test("does not grant an account the switch had to derive on the target network", async () => {
    const vault = vaultWallet({ accounts: [sepolia], active: sepolia.id, grant: [sepolia.id] });
    const { held, visible } = await approveSwitch(vault.wallet);
    await expect(held).resolves.toEqual({ chainId: MAINNET_CHAIN_ID, ok: true });
    expect(vault.derived).toEqual([account.id]);
    expect(vault.grants).toEqual([]);
    expect(visible).toEqual([]);
  });

  test("lands on the account the origin already holds on the target network", async () => {
    // The page only ever sees the active (Sepolia) account, so the account it
    // holds on Mainnet is read from the stored grant: the switch selects it
    // over the vault's first Mainnet account, grants nothing, and queues no
    // reconnect prompt because the dapp is still connected after the switch.
    const grantedMainnet: AccountRef = { ...account, address: "0x7777", id: "SN_MAIN:0x7777" };
    const vault = vaultWallet({
      accounts: [sepolia, account, grantedMainnet],
      active: sepolia.id,
      grant: [sepolia.id, grantedMainnet.id],
    });
    const { approved, held, visible } = await approveSwitch(vault.wallet);
    expect(approved).toEqual({ chainId: MAINNET_CHAIN_ID, ok: true, pending: [] });
    await expect(held).resolves.toEqual({ chainId: MAINNET_CHAIN_ID, ok: true });
    expect(vault.activeId()).toBe(grantedMainnet.id);
    expect(vault.grants).toEqual([]);
    expect(visible).toEqual([grantedMainnet]);
  });

  test("keeps the active account when it is already on the target network", async () => {
    // The active Mainnet account is connected and the grant also covers an
    // earlier Mainnet account, which the stored-grant lookup would prefer. A
    // switch to the network the wallet is already on must not hop accounts.
    const grantedMainnet: AccountRef = { ...account, address: "0x7777", id: "SN_MAIN:0x7777" };
    const vault = vaultWallet({
      accounts: [sepolia, grantedMainnet, account],
      active: account.id,
      grant: [account.id, grantedMainnet.id],
    });
    const { approved, visible } = await approveSwitch(vault.wallet);
    expect(approved).toEqual({ chainId: MAINNET_CHAIN_ID, ok: true, pending: [] });
    expect(vault.activeId()).toBe(account.id);
    expect(visible).toEqual([account]);
  });

  test("ignores a grant id the vault holds on another network", async () => {
    // Granted only on Sepolia: none of its ids may steer the Mainnet landing.
    const vault = vaultWallet({
      accounts: [sepolia, account],
      active: sepolia.id,
      grant: [sepolia.id],
    });
    await approveSwitch(vault.wallet);
    expect(vault.activeId()).toBe(account.id);
  });

  test("never lands on an account another origin's grant covers (audit 124)", async () => {
    // Only a different site holds a Mainnet account. That grant says nothing
    // about this origin, so the switch must not steer onto it: it lands on the
    // vault's default Mainnet account and, since this origin holds none there,
    // queues the reconnect prompt instead of sharing anything.
    const otherMainnet: AccountRef = { ...account, address: "0x8888", id: "SN_MAIN:0x8888" };
    const vault = vaultWallet({
      accounts: [sepolia, account, otherMainnet],
      active: sepolia.id,
      grant: [sepolia.id],
      otherGrants: [{ accountIds: [otherMainnet.id], origin: "https://other.example" }],
    });
    const { approved, held, visible } = await approveSwitch(vault.wallet);
    await expect(held).resolves.toEqual({ chainId: MAINNET_CHAIN_ID, ok: true });
    expect(vault.activeId()).toBe(account.id);
    expect(vault.grants).toEqual([]);
    expect(visible).toEqual([]);
    expect(approved.pending).toEqual([
      expect.objectContaining({ existingGrant: true, kind: "connect", origin }),
    ]);
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
