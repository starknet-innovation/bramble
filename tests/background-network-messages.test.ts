/**
 * Background network message checks prove network switches keep account state reactive.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../src/background/messages";
import { networkRpcUrls, unavailablePreferencesStore } from "../src/background/runtime-state";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import { STARKNET_NETWORKS } from "../src/starknet/networks";
import type { InvokeInput } from "../src/starknet/rpc";
import { defaultWalletPreferences, type WalletPreferences } from "../src/storage/preferences-store";
import type { AccountRef } from "../src/storage/vault-schema";
import type { EnsureNetworkAccountInput, WalletStatus } from "../src/wallet/vault-service";
import { flushHeld, latestApprovalId } from "./support/held";

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
const mainnetAccount: AccountRef = {
  ...account,
  address: "0xabc111111",
  classHash: "0x111111",
  id: "SN_MAIN:0xabc111111",
  networkId: "SN_MAIN",
};
const sender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/popup.html",
};
const contentSender: RuntimeSender = { id: "extension-id", url: "https://example.com/app" };
const vaultPassphrase = "correct horse battery staple";
const status: WalletStatus = {
  accountCount: 1,
  activeAccountId: account.id,
  hasVault: true,
  locked: true,
  ready: true,
};

describe("background network messages", () => {
  test("derives and selects a same-key account when switching to a missing network", async () => {
    const ensured: EnsureNetworkAccountInput[] = [];
    let accounts: readonly AccountRef[] = [account];
    let activeAccountId = account.id;
    let preferences: WalletPreferences = {
      ...defaultWalletPreferences(),
      activeNetworkId: "SN_SEPOLIA",
    };
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(
      {
        async createAccount() {
          return account;
        },
        async addDerivedAccount() {
          return account;
        },
        async ensureNetworkAccount(input) {
          ensured.push(input);
          accounts = [account, mainnetAccount];
          activeAccountId = mainnetAccount.id;
          return mainnetAccount;
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
        async readVault(passphrase: string) {
          if (passphrase !== vaultPassphrase) {
            throw new Error("bad passphrase");
          }
          return {
            accounts,
            activeAccountId,
            mnemonic: null,
            originGrants: [],
            schemaVersion: 3 as const,
            signingKeys: accounts.map((stored) => ({
              accountId: stored.id,
              privateKey: "0x123456",
            })),
          };
        },
        async setActiveAccount() {
          return account;
        },
        async signHash() {
          return { publicKey: "0xabc", r: "0x1", s: "0x2" };
        },
        async status() {
          return { ...status, accountCount: accounts.length, activeAccountId };
        },
      },
      "extension-id",
      {
        preferencesStore: {
          ...unavailablePreferencesStore,
          async read() {
            return preferences;
          },
          async saveAddress() {
            throw new Error("unused");
          },
          async setActiveNetwork(networkId) {
            preferences = { ...preferences, activeNetworkId: networkId };
            return preferences;
          },
          async setRpcOverride() {
            throw new Error("unused");
          },
          async upsertToken() {
            throw new Error("unused");
          },
        },
        session,
      },
    );

    await expect(
      handler({ networkId: "SN_MAIN", type: "wallet.setActiveNetwork" }, sender),
    ).resolves.toMatchObject({
      accountCount: 2,
      activeAccountId: mainnetAccount.id,
      accounts: [account, mainnetAccount],
      locked: false,
      networkId: "SN_MAIN",
    });
    expect(ensured).toEqual([{ networkId: "SN_MAIN", vaultPassphrase }]);
  });

  test("switches dapp chains and submits invokes on the selected network", async () => {
    const invoked: InvokeInput[] = [];
    let accounts: readonly AccountRef[] = [account];
    let activeAccountId = account.id;
    let grantedAccountIds: readonly string[] = [account.id];
    let preferences: WalletPreferences = {
      ...defaultWalletPreferences(),
      activeNetworkId: "SN_SEPOLIA",
    };
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(
      {
        async createAccount() {
          return account;
        },
        async addDerivedAccount() {
          return account;
        },
        async ensureNetworkAccount() {
          accounts = [account, mainnetAccount];
          activeAccountId = mainnetAccount.id;
          return mainnetAccount;
        },
        async getGrantedAccounts(origin: string) {
          return origin === "https://example.com"
            ? accounts.filter((stored) => grantedAccountIds.includes(stored.id))
            : [];
        },
        async generateMnemonic() {
          return "habit hope tip crystal because grunt nation idea electric witness alert like";
        },
        async grantOrigin(input) {
          grantedAccountIds = [...new Set([...grantedAccountIds, input.accountId ?? account.id])];
          return accounts.filter((stored) => grantedAccountIds.includes(stored.id));
        },
        async readVault() {
          return {
            accounts,
            activeAccountId,
            mnemonic: null,
            originGrants: [{ accountIds: grantedAccountIds, origin: "https://example.com" }],
            schemaVersion: 3 as const,
            signingKeys: accounts.map((stored) => ({
              accountId: stored.id,
              privateKey: "0x123456",
            })),
          };
        },
        async setActiveAccount() {
          activeAccountId = mainnetAccount.id;
          return mainnetAccount;
        },
        async signHash() {
          return { publicKey: "0xabc", r: "0x1", s: "0x2" };
        },
        async status() {
          return { ...status, accountCount: accounts.length, activeAccountId };
        },
      },
      "extension-id",
      {
        preferencesStore: {
          ...unavailablePreferencesStore,
          async read() {
            return preferences;
          },
          async saveAddress() {
            throw new Error("unused");
          },
          async setActiveNetwork(networkId) {
            preferences = { ...preferences, activeNetworkId: networkId };
            return preferences;
          },
          async setRpcOverride() {
            throw new Error("unused");
          },
          async upsertToken() {
            throw new Error("unused");
          },
        },
        runtimeRpc: {
          async estimateInvokeFee() {
            return { overallFee: "1", unit: "FRI" };
          },
          async getDeploymentStatus() {
            return true;
          },
          async getNftOwner() {
            return "0x0";
          },
          async getTransactionStatuses() {
            return {};
          },
          async getTokenBalances() {
            return [];
          },
          async getTokenMetadata() {
            return { decimals: 18, name: "Token", symbol: "TKN" };
          },
          async submitDeclareTransaction() {
            return { classHash: "0x1", transactionHash: "0x1" };
          },
          async submitAccountDeployment() {
            throw new Error("unused");
          },
          async submitErc20Transfer() {
            throw new Error("unused");
          },
          async submitInvokeTransaction(input) {
            invoked.push(input);
            return { calls: input.calls, transactionHash: "0x123" };
          },
        },
        session,
      },
    );

    // Switching the chain is held behind an approval; approving performs the
    // switch and returns the new chain id to the dapp.
    const switchHeld = handler(
      {
        chainId: "0x534e5f4d41494e",
        origin: "https://example.com",
        type: "wallet.switchChain",
      },
      contentSender,
    );
    await flushHeld();
    const switchId = await latestApprovalId(handler, sender);
    await expect(
      handler({ id: switchId, type: "wallet.approveOrigin" }, sender),
    ).resolves.toMatchObject({ chainId: "0x534e5f4d41494e", ok: true, pending: [] });
    await expect(switchHeld).resolves.toEqual({ chainId: "0x534e5f4d41494e", ok: true });

    // A connected dapp invoke is queued as an approval, not auto-submitted.
    const invokeHeld = handler(
      {
        calls: [{ calldata: ["0x1"], contractAddress: "0x123", entrypoint: "transfer" }],
        origin: "https://example.com",
        type: "wallet.addInvokeTransaction",
      },
      contentSender,
    );
    await flushHeld();
    const listed = await handler({ type: "wallet.pendingApprovals" }, sender);
    expect((listed as { pending: readonly unknown[] }).pending.at(-1)).toMatchObject({
      kind: "invoke",
      origin: "https://example.com",
    });
    expect(invoked).toHaveLength(0);

    const invokeId = await latestApprovalId(handler, sender);
    await expect(
      handler({ id: invokeId, type: "wallet.approveOrigin" }, sender),
    ).resolves.toMatchObject({ ok: true, pending: [] });
    await expect(invokeHeld).resolves.toMatchObject({ ok: true, transactionHash: "0x123" });

    expect(invoked[0]).toMatchObject({
      account: mainnetAccount,
      rpcUrls: ["https://api.cartridge.gg/x/starknet/mainnet"],
    });
    expect(grantedAccountIds).toEqual([account.id, mainnetAccount.id]);
  });

  test("prefers the user's custom RPC endpoint and keeps built-ins as fallback", () => {
    const preferences = defaultWalletPreferences();
    expect(networkRpcUrls(STARKNET_NETWORKS.SN_MAIN, preferences)).toEqual([
      "https://api.cartridge.gg/x/starknet/mainnet",
    ]);
    expect(
      networkRpcUrls(STARKNET_NETWORKS.SN_MAIN, {
        ...preferences,
        rpcOverrides: { SN_MAIN: "https://my-node.example/rpc" },
      }),
    ).toEqual(["https://my-node.example/rpc", "https://api.cartridge.gg/x/starknet/mainnet"]);
  });
});
