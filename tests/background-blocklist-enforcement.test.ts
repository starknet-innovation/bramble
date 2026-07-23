/**
 * Blocklist enforced beyond connect (A-M2 / A-L1): a blocklisted origin that
 * somehow still holds an old grant must get [] or an error from every dapp
 * surface — getGrantedAccounts, getPermissions, watchAsset, addInvokeTransaction,
 * signTypedData, and switchChain — not just at requestAccounts.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeRpc } from "../src/background/runtime-rpc";
import { unavailablePreferencesStore } from "../src/background/runtime-state";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import type { AccountRef } from "../src/storage/vault-schema";

const BLOCKED = "https://starknet-airdrop.com";
const blockedSender: RuntimeSender = { id: "extension-id", url: `${BLOCKED}/app` };
const vaultPassphrase = "correct horse battery staple";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

// A hostile stub that hands the blocked origin a live grant, proving the
// blocklist re-check — not an empty grant — is what stops it.
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
    return "unused";
  },
  async grantOrigin() {
    return [account];
  },
  async readVault() {
    return {
      accounts: [account],
      activeAccountId: account.id,
      mnemonic: null,
      originGrants: [{ accountIds: [account.id], origin: BLOCKED }],
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
};

const rpc = {
  async getTokenMetadata() {
    return { decimals: 18, name: "Ether", symbol: "ETH" };
  },
  async submitInvokeTransaction(input: unknown) {
    return input;
  },
} as unknown as RuntimeRpc;

const makeHandler = () => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  return createMessageHandler(walletStub, "extension-id", {
    preferencesStore: unavailablePreferencesStore,
    runtimeRpc: rpc,
    session,
  });
};

describe("blocklist enforced beyond connect (A-M2)", () => {
  test("getGrantedAccounts returns no accounts for a blocked origin", async () => {
    await expect(
      makeHandler()({ origin: BLOCKED, type: "wallet.getGrantedAccounts" }, blockedSender),
    ).resolves.toEqual({ accounts: [], ok: true });
  });

  test("getPermissions returns no permissions for a blocked origin", async () => {
    await expect(
      makeHandler()({ origin: BLOCKED, type: "wallet.getPermissions" }, blockedSender),
    ).resolves.toEqual({ ok: true, permissions: [] });
  });

  test("watchAsset is rejected for a blocked origin", async () => {
    await expect(
      makeHandler()(
        { asset: { address: "0x1" }, origin: BLOCKED, type: "wallet.watchAsset" },
        blockedSender,
      ),
    ).resolves.toEqual({ error: "origin blocked" });
  });

  test("addInvokeTransaction is rejected for a blocked origin", async () => {
    await expect(
      makeHandler()(
        {
          calls: [{ calldata: ["0x1"], contractAddress: "0x2", entrypoint: "transfer" }],
          origin: BLOCKED,
          type: "wallet.addInvokeTransaction",
        },
        blockedSender,
      ),
    ).resolves.toEqual({ error: "origin blocked" });
  });

  test("signTypedData is rejected for a blocked origin", async () => {
    await expect(
      makeHandler()(
        {
          origin: BLOCKED,
          type: "wallet.signTypedData",
          typedData: { domain: { name: "Airdrop" }, primaryType: "Claim" },
        },
        blockedSender,
      ),
    ).resolves.toEqual({ error: "origin blocked" });
  });

  test("switchChain is rejected for a blocked origin", async () => {
    await expect(
      makeHandler()(
        { chainId: "0x534e5f4d41494e", origin: BLOCKED, type: "wallet.switchChain" },
        blockedSender,
      ),
    ).resolves.toEqual({ error: "origin blocked" });
  });
});
