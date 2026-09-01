/**
 * Shared background harness for the wallet-operation suites (transfer review,
 * transfer submission, and the activity feed).
 *
 * The fixtures live here rather than in one suite so the review-fee suites and
 * the transaction/activity suite drive the same wallet stub, account, and RPC
 * defaults — a second hand-rolled copy would let the two disagree about what a
 * review returns. Every option defaults to the benign case, so a test spells
 * out only the failure it exercises.
 */
import type { TransactionStatusReport } from "@mc-wallet/starknet/rpc";
import { createMemoryStore } from "@mc-wallet/store/kv";
import { type ActivityEntry, createActivityLog } from "@mc-wallet/transactions/activity";
import type { Vault } from "@mc-wallet/vault/schema";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";

/** ETH contract the harness's token id and transfer calls resolve to. */
export const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

/** Single mainnet account backing every wallet-ops suite. */
export const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

/** Privileged extension-page sender the suites dispatch through. */
export const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
export const vaultPassphrase = "correct horse battery staple";
export const tokenId = `SN_MAIN:ETH:${ETH}`;

const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;

const walletStub = {
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
    return [account];
  },
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

/**
 * Failure and data switches a wallet-ops suite can flip. `estimateError`
 * replaces the thrown estimate failure so a suite can assert how a specific
 * rejection shape (an RPC envelope, say) is reported.
 */
export type WalletOpsHarnessOptions = {
  readonly balanceThrows?: boolean;
  readonly deployed?: boolean;
  readonly estimateError?: unknown;
  readonly estimateFails?: boolean;
  readonly onChainHistory?: readonly ActivityEntry[];
  readonly historyThrows?: boolean;
  readonly statusReport?: TransactionStatusReport;
  readonly strkBalance?: string;
};

/**
 * Builds an unlocked background message handler over the shared fixtures,
 * returning it with the activity log, session, and the status hashes the RPC
 * stub was asked about.
 */
export const makeWalletOpsHarness = (options?: WalletOpsHarnessOptions) => {
  const history =
    options?.historyThrows || options?.onChainHistory
      ? {
          async getTransactionHistory(): Promise<readonly ActivityEntry[]> {
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
  const handler = createMessageHandler(walletStub, "extension-id", {
    activity,
    // The activity log stamps entries on its own monotonic test clock, so the
    // reconciliation clock reads from the same tick counter — otherwise every
    // recorded transaction looks older than its observation window.
    now: () => tick,
    runtimeRpc: {
      async estimateInvokeFee() {
        if (options?.estimateError !== undefined) {
          throw options.estimateError;
        }
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
            options?.statusReport ?? { finalizedOnL1: false, found: true, status: "accepted" },
          ]),
        );
      },
      async submitDeclareTransaction() {
        return { classHash: "0x1", transactionHash: "0x1" };
      },
      async submitAccountDeployment() {
        return { transactionHash: "0x7de" };
      },
      async submitErc20Transfer() {
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
  return { activity, handler, session, statusRequests };
};
