/**
 * Background status message checks prove public wallet state is derived from vault state.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import type { AccountRef } from "../src/storage/vault-schema";
import type { WalletStatus } from "../src/wallet/vault-service";

const account: AccountRef = {
  address: "0xabcabcdef",
  classHash: "0xabcdef",
  derivation: {
    accountIndex: 0,
    addressIndex: 0,
    kind: "starknet-bip44",
  },
  id: "SN_SEPOLIA:0xabcabcdef",
  networkId: "SN_SEPOLIA",
  publicKeyX: "0xabc",
  publicKeyY: "0xdef",
};
const sender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/popup.html",
};
const vaultPassphrase = "correct horse battery staple";
const status: WalletStatus = {
  accountCount: 1,
  activeAccountId: account.id,
  hasVault: true,
  locked: true,
  ready: true,
};

const createStatusWallet = (statusAccount: AccountRef = account) => ({
  async createAccount() {
    return statusAccount;
  },
  async getGrantedAccounts() {
    return [];
  },
  async grantOrigin() {
    return [statusAccount];
  },
  async readVault(passphrase: string) {
    if (passphrase !== vaultPassphrase) {
      throw new Error("bad passphrase");
    }
    return {
      accounts: [statusAccount],
      activeAccountId: statusAccount.id,
      originGrants: [],
      schemaVersion: 1 as const,
      signingKeys: [{ accountId: statusAccount.id, privateKey: "0x123456" }],
    };
  },
  async signHash() {
    return {
      publicKey: "0xabc",
      r: "0x1",
      s: "0x2",
    };
  },
  async status() {
    return status;
  },
});

describe("background status messages", () => {
  test("returns public wallet status for trusted senders", async () => {
    const handler = createMessageHandler(createStatusWallet(), "extension-id");

    await expect(handler({ type: "wallet.status" }, sender)).resolves.toMatchObject({
      accountCount: 1,
      network: "Starknet Sepolia",
      ready: true,
    });
  });

  test("returns the active account network after unlock", async () => {
    const mainnetAccount: AccountRef = {
      ...account,
      id: `SN_MAIN:${account.address}`,
      networkId: "SN_MAIN",
    };
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(
      createStatusWallet(mainnetAccount),
      "extension-id",
      session,
    );

    await expect(handler({ type: "wallet.status" }, sender)).resolves.toMatchObject({
      activeAccountId: mainnetAccount.id,
      locked: false,
      network: "Starknet Mainnet",
    });
  });
});
