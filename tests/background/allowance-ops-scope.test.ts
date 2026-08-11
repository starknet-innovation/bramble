/**
 * Allowance listing must be scoped to the active account: an allowance granted
 * by another account must not surface (nor be revocable) under the account the
 * user currently has active.
 */
import { describe, expect, test } from "bun:test";
import { memoryAllowanceStore } from "@mc-wallet/transactions/allowance-store";
import type { Vault } from "@mc-wallet/vault/schema";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { createMessageHandler } from "../../apps/extension/src/background/messages";
import type { RuntimeSender } from "../../apps/extension/src/background/senders";
import { createUnlockSession } from "../../apps/extension/src/background/session";
import { makeRuntimeRpc } from "../support/runtime-rpc-stub";

const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const OTHER_ACCOUNT_ID = "SN_MAIN:0x9999999999999999999999999999999999999999999999999999999999abcd";
const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
const vaultPassphrase = "correct horse battery staple";
const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

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
    return vault;
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
      ready: false,
    };
  },
};

const makeHarness = () => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const allowanceStore = memoryAllowanceStore();
  const handler = createMessageHandler(walletStub, "extension-id", {
    allowanceStore,
    runtimeRpc: makeRuntimeRpc(),
    session,
  });
  return { allowanceStore, handler };
};

describe("allowance listing scope", () => {
  test("hides allowances granted by other accounts", async () => {
    const { allowanceStore, handler } = makeHarness();
    await allowanceStore.record({
      accountId: account.id,
      amount: "1000",
      networkId: "SN_MAIN",
      spender: "0x5",
      token: TOKEN,
    });
    await allowanceStore.record({
      accountId: OTHER_ACCOUNT_ID,
      amount: "2000",
      networkId: "SN_MAIN",
      spender: "0x6",
      token: TOKEN,
    });

    const response = (await handler({ type: "wallet.allowances" }, extensionSender)) as {
      allowances: readonly { accountId: string; amount: string }[];
    };
    expect(response.allowances).toHaveLength(1);
    expect(response.allowances[0]).toMatchObject({ accountId: account.id, amount: "1000" });
  });
});
