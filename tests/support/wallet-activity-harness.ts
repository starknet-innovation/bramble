/**
 * Shared harness for the background wallet/activity message boundary.
 *
 * Lives here rather than inside one test file because more than one suite needs
 * the same handler, activity log, and RPC stubs, and `AGENTS.md` asks background
 * message tests to share a factory instead of re-declaring wallet/RPC doubles —
 * two drifting copies of these stubs would quietly test two different wallets.
 *
 * The clock is monotonic: the activity log advances it on every write and the
 * handler reads the current value, so recorded entries and history-sync stamps
 * are ordered the way they would be in a real session.
 */
import { createPreferencesStore, type WalletPreferences } from "@bramble/settings/preferences";
import type { TransactionStatusReport, TransferInput } from "@bramble/starknet/rpc";
import { createMemoryStore } from "@bramble/store/kv";
import { type ActivityEntry, createActivityLog } from "@bramble/transactions/activity";
import type { TransactionHistoryScan } from "@bramble/transactions/tx-history-scan";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import { testExtension, vaultPassphrase } from "./background-wallet-stub";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
export const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
export const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
export const reviewedFee = { overallFee: "2500000000000000", unit: "FRI" } as const;
export const reviewedDeploymentFee = { overallFee: "1000000000000000", unit: "FRI" } as const;
const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
export const tokenId = `SN_MAIN:ETH:${ETH}`;
export const OTHER_ACCOUNT_ID =
  "SN_MAIN:0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
export const SEPOLIA_ACCOUNT_ID = `SN_SEPOLIA:${account.address}`;
export type ActivityResponse = {
  readonly activity: readonly ActivityEntry[];
  readonly historyUnavailable?: boolean;
};
const walletStub = {
  addDerivedAccount: async () => account,
  createAccount: async () => account,
  ensureNetworkAccount: async () => account,
  getGrantedAccounts: async () => [account],
  async generateMnemonic() {
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
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
export const makeHarness = (options?: {
  readonly balanceThrows?: boolean;
  readonly deployed?: boolean;
  readonly estimateFails?: boolean;
  readonly onChainHistory?: readonly ActivityEntry[];
  readonly historyThrows?: boolean;
  /** Sees each history scan request, such as the tokens it covers. */
  readonly onHistoryScan?: (scan: TransactionHistoryScan) => void;
  /** Preferences the background reads instead of the defaults. */
  readonly preferences?: WalletPreferences;
  readonly statusReport?: TransactionStatusReport;
  readonly strkBalance?: string;
  /** Replaces the default successful transfer submission. */
  readonly submitTransfer?: (input: TransferInput) => Promise<{ readonly transactionHash: string }>;
}) => {
  let historyRequests = 0;
  const history =
    options?.historyThrows || options?.onChainHistory || options?.onHistoryScan
      ? {
          async getTransactionHistory(
            scan: TransactionHistoryScan,
          ): Promise<readonly ActivityEntry[]> {
            historyRequests += 1;
            options.onHistoryScan?.(scan);
            if (options.historyThrows) {
              throw new Error("fetch failed");
            }
            return options.onChainHistory ?? [];
          },
        }
      : {};
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  let tick = 0;
  const activity = createActivityLog({
    now: () => {
      tick += 1000;
      return tick;
    },
    store: createMemoryStore(),
  });
  const statusRequests: string[][] = [];
  const preferences = options?.preferences;
  const handler = createMessageHandler(walletStub, testExtension, {
    activity,
    now: () => tick,
    ...(preferences
      ? {
          preferencesStore: {
            ...createPreferencesStore({ store: createMemoryStore() }),
            read: async () => preferences,
          },
        }
      : {}),
    runtimeRpc: {
      async estimateAccountDeploymentFee() {
        return reviewedDeploymentFee;
      },
      async estimateInvokeFee() {
        if (options?.estimateFails) {
          throw new Error("rpc unavailable");
        }
        return { overallFee: "2500000000000000", unit: "FRI" };
      },
      async getDeploymentStatus() {
        return options?.deployed ?? true;
      },
      async getNftOwner() {
        return "0x0";
      },
      async getTokenBalances({ tokens }) {
        if (options?.balanceThrows) {
          throw new Error("balance unavailable");
        }
        if (options?.strkBalance === undefined) {
          return [];
        }
        return tokens.map((token) => ({
          ...token,
          balance: options.strkBalance ?? "0",
          formatted: options.strkBalance ?? "0",
        }));
      },
      async getTokenMetadata() {
        return { decimals: 18, name: "Token", symbol: "TKN" };
      },
      async getTransactionStatuses({ hashes }) {
        statusRequests.push([...hashes]);
        return Object.fromEntries(
          hashes.map((hash) => [
            hash,
            options?.statusReport ?? {
              finalizedOnL1: false,
              found: true,
              seen: true,
              status: "accepted",
            },
          ]),
        );
      },
      async submitDeclareTransaction() {
        return { classHash: "0x1", transactionHash: "0x1" };
      },
      async submitAccountDeployment() {
        return { transactionHash: "0x7de" };
      },
      async submitErc20Transfer(input) {
        if (options?.submitTransfer) {
          const { transactionHash } = await options.submitTransfer(input);
          return {
            call: { calldata: [], contractAddress: ETH, entrypoint: "transfer" },
            transactionHash,
          };
        }
        return {
          call: {
            calldata: ["0x777", "1500000000000000000", "0"],
            contractAddress: ETH,
            entrypoint: "transfer",
          },
          transactionHash: "0x7ab",
        };
      },
      async submitInvokeTransaction() {
        return { calls: [], transactionHash: "0x7cd" };
      },
      ...history,
    },
    session,
  });
  return { activity, handler, historyRequests: () => historyRequests, session, statusRequests };
};
