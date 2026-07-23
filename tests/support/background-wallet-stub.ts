/**
 * Shared background-dispatcher test fixtures: a capturing wallet stub plus
 * the canonical senders, account, and vault passphrase used by the
 * background-message suites.
 */
import type { RuntimeSender } from "../../src/background/senders";
import type { AccountRef } from "../../src/storage/vault-schema";
import type {
  CreateVaultAccountInput,
  OriginGrantInput,
  SignHashInput,
  WalletStatus,
} from "../../src/wallet/vault-service";

/**
 * Single stub account used by the dispatcher suites.
 */
export const account: AccountRef = {
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

/**
 * Content-script sender for https://example.com pages.
 */
export const contentSender: RuntimeSender = { id: "extension-id", url: "https://example.com/app" };

/**
 * Extension-page sender accepted for privileged messages.
 */
export const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/popup.html",
};

/**
 * Vault passphrase the stub wallet accepts.
 */
export const vaultPassphrase = "correct horse battery staple";

const status: WalletStatus = {
  accountCount: 1,
  activeAccountId: account.id,
  hasVault: true,
  locked: true,
  ready: true,
};

/**
 * Builds the capturing wallet stub; optional callbacks observe create, sign,
 * and grant inputs.
 */
export const createWallet = (
  captureCreate?: (input: CreateVaultAccountInput) => void,
  captureSign?: (input: SignHashInput) => void,
  captureGrant?: (input: OriginGrantInput) => void,
) => ({
  async createAccount(input: CreateVaultAccountInput) {
    captureCreate?.(input);
    return account;
  },
  async addDerivedAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async importRawKeyAccount() {
    return account;
  },
  async getGrantedAccounts(origin: string) {
    return origin === "https://example.com" ? [account] : [];
  },
  async generateMnemonic() {
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
  },
  async grantOrigin(input: OriginGrantInput) {
    captureGrant?.(input);
    return [account];
  },
  async readVault(passphrase: string) {
    if (passphrase !== vaultPassphrase) {
      throw new Error("bad passphrase");
    }
    return {
      accounts: [account],
      activeAccountId: account.id,
      mnemonic: null,
      originGrants: [{ accountIds: [account.id], origin: "https://example.com" }],
      schemaVersion: 3 as const,
      signingKeys: [{ accountId: account.id, privateKey: "0x123456" }],
    };
  },
  async setActiveAccount() {
    return account;
  },
  async signHash(input: SignHashInput) {
    captureSign?.(input);
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
