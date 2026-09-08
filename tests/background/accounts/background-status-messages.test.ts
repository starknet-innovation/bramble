/**
 * Background status message checks prove public wallet state is derived from vault state.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import type { WalletStatus } from "@bramble/vault/service";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { unavailablePreferencesStore } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";

const account: AccountRef = {
  accountContractType: "openzeppelin",
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
  async addDerivedAccount() {
    return statusAccount;
  },
  async ensureNetworkAccount() {
    return statusAccount;
  },
  async getGrantedAccounts() {
    return [];
  },
  async generateMnemonic() {
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
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
      accountSecrets: [],
      activeAccountId: statusAccount.id,
      importedSeeds: [],
      mnemonic: null,
      originGrants: [],
      schemaVersion: 8 as const,
      signingKeys: [{ accountId: statusAccount.id, privateKey: "0x123456" }],
    };
  },
  async setActiveAccount() {
    return statusAccount;
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
  test("returns public wallet status without account metadata while locked", async () => {
    const handler = createMessageHandler(createStatusWallet(), "extension-id");

    await expect(handler({ type: "wallet.status" }, sender)).resolves.toMatchObject({
      accountCount: 0,
      activeAccountId: null,
      accounts: [],
      locked: true,
      network: "Starknet Mainnet",
      ready: true,
    });
  });

  test("returns the selected network after unlock", async () => {
    const mainnetAccount: AccountRef = {
      ...account,
      id: `SN_MAIN:${account.address}`,
      networkId: "SN_MAIN",
    };
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(createStatusWallet(mainnetAccount), "extension-id", {
      preferencesStore: {
        ...unavailablePreferencesStore,
        async read() {
          return { ...defaultWalletPreferences(), activeNetworkId: "SN_MAIN" };
        },
        async saveAddress() {
          throw new Error("unused");
        },
        async setActiveNetwork() {
          throw new Error("unused");
        },
        async setRpcOverride() {
          throw new Error("unused");
        },
        async upsertToken() {
          throw new Error("unused");
        },
      },
      session,
    });

    await expect(handler({ type: "wallet.status" }, sender)).resolves.toMatchObject({
      activeAccountId: mainnetAccount.id,
      locked: false,
      network: "Starknet Mainnet",
      networkId: "SN_MAIN",
    });
  });
});
