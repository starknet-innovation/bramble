/**
 * Account-lifecycle message checks: adding a derived account needs an unlocked
 * session and an extension page, and revealing secrets needs the passphrase
 * re-entered in the message rather than taken from the cached session.
 */
import { describe, expect, test } from "bun:test";
import type { AddDerivedAccountInput } from "@mc-wallet/vault/service";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";

const account: AccountRef = {
  address: "0xabcabcdef",
  classHash: "0xabcdef",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_SEPOLIA:0xabcabcdef",
  networkId: "SN_SEPOLIA",
  publicKeyX: "0xabc",
  publicKeyY: "0xdef",
};

const derived: AccountRef = {
  ...account,
  address: "0xdeadbeef",
  derivation: { accountIndex: 1, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_SEPOLIA:0xdeadbeef",
};

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultPassphrase = "correct horse battery staple";
const sender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const contentSender: RuntimeSender = { id: "extension-id", url: "https://example.com/app" };

const createWallet = (captureAdd?: (input: AddDerivedAccountInput) => void) => ({
  async addDerivedAccount(input: AddDerivedAccountInput) {
    captureAdd?.(input);
    return derived;
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
    return mnemonic;
  },
  async grantOrigin() {
    return [account];
  },
  async readVault(passphrase: string) {
    if (passphrase !== vaultPassphrase) {
      throw new Error("bad passphrase");
    }
    return {
      accounts: [account],
      accountSecrets: [],
      activeAccountId: account.id,
      mnemonic,
      originGrants: [],
      schemaVersion: 5 as const,
      signingKeys: [{ accountId: account.id, privateKey: "0x1234" }],
    };
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
      locked: false,
      ready: true,
    };
  },
});

describe("account lifecycle messages", () => {
  test("adds a derived account through the unlocked session", async () => {
    const captured: AddDerivedAccountInput[] = [];
    const session = createUnlockSession();
    const handler = createMessageHandler(
      createWallet((input) => captured.push(input)),
      "extension-id",
      { session },
    );

    await expect(
      handler({ networkId: "SN_SEPOLIA", type: "wallet.addAccount" }, sender),
    ).resolves.toEqual({ error: "wallet locked" });
    await handler({ type: "wallet.unlock", vaultPassphrase }, sender);
    await expect(
      handler({ networkId: "SN_SEPOLIA", type: "wallet.addAccount" }, sender),
    ).resolves.toEqual({ account: derived, ok: true });
    expect(captured.at(-1)).toEqual({ networkId: "SN_SEPOLIA", vaultPassphrase });
  });

  test("rejects add-account from content senders and malformed networks", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(createWallet(), "extension-id", { session });

    await expect(
      handler({ networkId: "SN_SEPOLIA", type: "wallet.addAccount" }, contentSender),
    ).resolves.toEqual({ error: "privileged sender required" });
    await expect(
      handler({ networkId: "SN_BAD", type: "wallet.addAccount" }, sender),
    ).resolves.toEqual({ error: "invalid add account request" });
  });

  test("reveals active account secrets only with a re-entered passphrase", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id");

    await expect(
      handler({ type: "wallet.revealSecrets", vaultPassphrase }, sender),
    ).resolves.toEqual({ mnemonic, ok: true, privateKey: "0x1234" });
    await expect(
      handler({ type: "wallet.revealSecrets", vaultPassphrase: "wrong passphrase" }, sender),
    ).resolves.toEqual({ error: "bad passphrase" });
    await expect(
      handler({ type: "wallet.revealSecrets", vaultPassphrase }, contentSender),
    ).resolves.toEqual({ error: "privileged sender required" });
  });
});
