/**
 * Background approval message checks prove dapp requests can be denied.
 */
import { describe, expect, test } from "bun:test";
import type { WalletStatus } from "@bramble/vault/service";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createApprovalQueue } from "../../../apps/extension/src/background/approvals/approvals";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";

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
  async addDerivedAccount() {
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
    const handler = createMessageHandler(wallet, testExtension, {
      approvals,
      session: createUnlockSession(),
    });

    await expect(handler({ id: pending.id, type: "wallet.denyOrigin" }, sender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
  });
});
