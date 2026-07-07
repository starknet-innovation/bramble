/**
 * Background approval message checks prove dapp requests can be denied.
 */
import { describe, expect, test } from "bun:test";
import { createApprovalQueue } from "../src/background/approvals";
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
const status: WalletStatus = {
  accountCount: 1,
  activeAccountId: account.id,
  hasVault: true,
  locked: true,
  ready: true,
};

const wallet = {
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
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
  },
  async grantOrigin() {
    return [account];
  },
  async readVault() {
    throw new Error("unused");
  },
  async setActiveAccount() {
    return account;
  },
  async signHash() {
    return { publicKey: "0xabc", r: "0x1", s: "0x2" };
  },
  async status() {
    return status;
  },
};

describe("background approval messages", () => {
  test("denies pending dapp account requests", async () => {
    const approvals = createApprovalQueue();
    const pending = approvals.request("https://example.com");
    const handler = createMessageHandler(wallet, "extension-id", createUnlockSession(), approvals);

    await expect(handler({ id: pending.id, type: "wallet.denyOrigin" }, sender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
  });
});
