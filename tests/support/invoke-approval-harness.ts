/**
 * Shared dApp invoke-approval harness. Centralizes the connected account,
 * sender identities, wallet double, and injectable RPC so approval tests do
 * not drift on their security boundary setup.
 */

import type { WalletPreferences, WalletPreferencesStore } from "@mc-wallet/settings/preferences";
import type { InvokeInput } from "@mc-wallet/starknet/rpc";
import { type ActivityLog, memoryActivityLog } from "@mc-wallet/transactions/activity";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { createApprovalQueue } from "../../apps/extension/src/background/approvals/approvals";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";
import type { RuntimeRpc } from "../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";

import { makeRuntimeRpc } from "./runtime-rpc-stub";

export const invokeAccount: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
export const invokeVaultPassphrase = "correct horse battery staple";
export const invokeOrigin = "https://dapp.example";
export const invokeContentSender: RuntimeSender = {
  id: "extension-id",
  url: `${invokeOrigin}/app`,
};
export const invokeExtensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const call = {
  calldata: ["0x5", "1000", "0"],
  contractAddress: "0x123",
  entrypoint: "transfer",
};

export const invokeWalletStub = (connected: readonly AccountRef[]) => ({
  async addDerivedAccount() {
    return invokeAccount;
  },
  async createAccount() {
    return invokeAccount;
  },
  async ensureNetworkAccount() {
    return invokeAccount;
  },
  async getGrantedAccounts(target: string) {
    return target === invokeOrigin ? connected : [];
  },
  async generateMnemonic() {
    return "unused";
  },
  async grantOrigin() {
    return connected;
  },
  async readVault() {
    return {
      accounts: [invokeAccount],
      accountSecrets: [],
      activeAccountId: invokeAccount.id,
      mnemonic: null,
      originGrants: [{ accountIds: [invokeAccount.id], origin: invokeOrigin }],
      schemaVersion: 7 as const,
      signingKeys: [{ accountId: invokeAccount.id, privateKey: "0x123456" }],
    };
  },
  async setActiveAccount() {
    return invokeAccount;
  },
  async signHash() {
    return { publicKey: invokeAccount.publicKeyX, r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: invokeAccount.id,
      hasVault: true,
      locked: false,
      ready: true,
    };
  },
});

export const fixedInvokePreferences = (preferences: WalletPreferences): WalletPreferencesStore =>
  ({ read: async () => preferences }) as unknown as WalletPreferencesStore;

/**
 * An activity log whose write always fails, standing in for a storage quota or
 * IO fault after a transaction has already been broadcast. Bookkeeping that
 * matters — the allowance log — must survive it.
 */
export const failingInvokeActivityLog = (): ActivityLog => ({
  ...memoryActivityLog(),
  record: () => Promise.reject(new Error("storage quota exceeded")),
});

export const makeInvokeHarness = (
  connected: readonly AccountRef[] = [invokeAccount],
  preferencesStore?: WalletPreferencesStore,
  rpcOverrides: Partial<RuntimeRpc> = {},
  activityLog?: ActivityLog,
) => {
  const session = createUnlockSession();
  session.unlock(invokeVaultPassphrase);
  const approvals = createApprovalQueue();
  const activity = activityLog ?? memoryActivityLog();
  const invoked: InvokeInput[] = [];
  const rpc = makeRuntimeRpc({
    async submitInvokeTransaction(input: InvokeInput) {
      invoked.push(input);
      return { calls: input.calls, transactionHash: "0x7cd" };
    },
    ...rpcOverrides,
  });
  const options = {
    activity,
    approvals,
    ...(preferencesStore === undefined ? {} : { preferencesStore }),
    runtimeRpc: rpc,
    session,
  };
  const handler = createMessageHandler(invokeWalletStub(connected), "extension-id", options);
  return { activity, handler, invoked, session };
};

export const invokeMessage = (
  target = invokeOrigin,
  calls: readonly {
    readonly calldata: readonly string[];
    readonly contractAddress: string;
    readonly entrypoint: string;
  }[] = [call],
) => ({
  calls,
  origin: target,
  type: "wallet.addInvokeTransaction" as const,
});
