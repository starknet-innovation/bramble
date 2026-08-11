/**
 * Shared multisig message-test harness: a full wallet/RPC stub wired through
 * createMessageHandler with controllable multisig chain reads, so lifecycle
 * tests do not each re-declare ~140 lines of stubbing.
 */

import type { MultisigProposalStatus } from "@mc-wallet/multisig/chain";
import { MULTISIG_CLASS_HASH } from "@mc-wallet/multisig/deploy";
import type { MultisigProposalDiscovery } from "@mc-wallet/multisig/discovery";
import { type MultisigStore, memoryMultisigStore } from "@mc-wallet/multisig/repository";
import type { ActivityLog, ActivityStatus } from "@mc-wallet/transactions/activity";
import type { Vault } from "@mc-wallet/vault/schema";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";

/**
 * Address of the multisig contract the harness watches.
 */
export const HARNESS_MULTISIG = "0x111111111111111111111111111111111111111111111111111111111111111";

/**
 * Target contract used by harness proposals.
 */
export const HARNESS_TARGET = "0x222222222222222222222222222222222222222222222222222222222222222";

/**
 * Second signer alongside the active account.
 */
export const HARNESS_OTHER_SIGNER =
  "0x444444444444444444444444444444444444444444444444444444444444444";

/**
 * Full-length transaction id so composed proposal ids exercise their real
 * ~139-character length (a short stub once masked an id-length cap).
 */
export const HARNESS_TX_ID = `0x7${"a".repeat(62)}`;

/**
 * Transaction hash returned by submitted invoke calls.
 */
export const HARNESS_SUBMIT_HASH = "0x7cd";

/**
 * Active harness account.
 */
export const harnessAccount: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

/**
 * Extension-page sender accepted for privileged messages.
 */
export const harnessExtensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

/**
 * Content-script sender that must be rejected for privileged messages.
 */
export const harnessContentSender: RuntimeSender = {
  id: "extension-id",
  url: "https://dapp.example/app",
};

/**
 * Harness knobs. `proposalStatus` and `deploymentStatus` are consulted on
 * every chain read so tests can change the reported state (or start
 * throwing) between calls; `loadClass` supplies the bundled Sierra artifact
 * for the declare flow.
 */
export type MultisigHarnessOptions = {
  readonly accounts?: readonly AccountRef[];
  readonly activeAccountId?: string;
  readonly activity?: ActivityLog;
  readonly classDeclared?: boolean;
  readonly contractAt?: boolean;
  readonly deploymentStatus?: () => boolean;
  readonly getTokenBalances?: (input: {
    readonly accountAddress: string;
  }) => Promise<readonly never[]>;
  readonly loadClass?: () => Promise<unknown>;
  readonly multisigStore?: MultisigStore;
  readonly multisigConfig?: () => {
    readonly quorum: number;
    readonly signers: readonly string[];
  };
  readonly proposalDiscovery?: () => MultisigProposalDiscovery;
  readonly proposalStatus?: (signer: string) => MultisigProposalStatus;
  readonly signers?: readonly string[];
  readonly submitInvoke?: (
    calls: readonly unknown[],
  ) => Promise<{ readonly transactionHash: string }>;
  readonly transactionStatuses?: () => Readonly<Record<string, ActivityStatus>>;
};

/**
 * Builds a message handler with an unlocked session, an in-memory multisig
 * store, and capture arrays for submitted invokes and declares.
 */
export const makeMultisigHarness = (options: MultisigHarnessOptions = {}) => {
  const session = createUnlockSession();
  session.unlock("correct horse battery staple");
  const multisigStore = options.multisigStore ?? memoryMultisigStore();
  const invokeCalls: (readonly unknown[])[] = [];
  const estimatedCalls: (readonly unknown[])[] = [];
  const submittedAccounts: string[] = [];
  const balanceReads: string[] = [];
  const declared: unknown[] = [];
  const accounts = options.accounts ?? [harnessAccount];
  let activeAccountId = options.activeAccountId ?? accounts[0]?.id ?? harnessAccount.id;
  const activeAccount = (): AccountRef =>
    accounts.find((account) => account.id === activeAccountId) ?? harnessAccount;
  const walletStub = {
    async addDerivedAccount() {
      return activeAccount();
    },
    async createAccount() {
      return activeAccount();
    },
    async ensureNetworkAccount() {
      return activeAccount();
    },
    async importRawKeyAccount() {
      return activeAccount();
    },
    async getGrantedAccounts() {
      return accounts;
    },
    async generateMnemonic() {
      return "unused";
    },
    async grantOrigin() {
      return accounts;
    },
    async readVault() {
      return { accounts, activeAccountId } as unknown as Vault;
    },
    async setActiveAccount(input: { readonly accountId: string }) {
      const selected = accounts.find((account) => account.id === input.accountId);
      if (!selected) throw new Error("account not found");
      activeAccountId = selected.id;
      return selected;
    },
    async signHash() {
      return { publicKey: activeAccount().publicKeyX, r: "0x1", s: "0x2" };
    },
    async status() {
      return {
        accountCount: accounts.length,
        activeAccountId,
        hasVault: true,
        locked: false,
        ready: false,
      };
    },
  };
  const handler = createMessageHandler(walletStub, "extension-id", {
    ...(options.activity ? { activity: options.activity } : {}),
    ...(options.loadClass ? { loadMultisigClass: options.loadClass } : {}),
    multisigStore,
    // The default in-memory activity log stamps entries at epoch 0, so the
    // reconciliation clock must agree or every harness transaction reads as
    // long past its observation window.
    now: () => 0,
    runtimeRpc: {
      async estimateInvokeFee(input) {
        estimatedCalls.push(input.calls);
        return { overallFee: "1", unit: "FRI" };
      },
      async getDeploymentStatus() {
        return options.deploymentStatus?.() ?? options.contractAt ?? false;
      },
      async getNftOwner() {
        return harnessAccount.address;
      },
      async getTokenBalances(input) {
        balanceReads.push(input.accountAddress);
        return options.getTokenBalances?.(input) ?? [];
      },
      async getTokenMetadata() {
        return { decimals: 18, name: "Ether", symbol: "ETH" };
      },
      async getTransactionStatuses() {
        return Object.fromEntries(
          Object.entries(options.transactionStatuses?.() ?? {}).map(([hash, status]) => [
            hash,
            { finalizedOnL1: false, found: true, status },
          ]),
        );
      },
      multisig: {
        async computeTransactionId() {
          return HARNESS_TX_ID;
        },
        ...(options.proposalDiscovery
          ? {
              async discoverProposalIds() {
                return options.proposalDiscovery?.() ?? { complete: true, ids: [] };
              },
            }
          : {}),
        async getConfig() {
          return (
            options.multisigConfig?.() ?? {
              quorum: 2,
              signers: options.signers ?? [harnessAccount.address, HARNESS_OTHER_SIGNER],
            }
          );
        },
        async getProposalStatus(input: { readonly signer: string; readonly txId: string }) {
          if (options.proposalStatus) {
            return options.proposalStatus(input.signer);
          }
          // Default chain behavior: a signer counts as having confirmed once
          // this harness recorded a confirm_transaction invoke for the id, so
          // confirm-then-revoke sequences pass their status gates like the
          // real component would report.
          const confirmedBySigner = invokeCalls.flat().some((entry) => {
            const call = entry as { calldata?: readonly string[]; entrypoint?: string };
            return call.entrypoint === "confirm_transaction" && call.calldata?.[0] === input.txId;
          });
          return { confirmations: 1, confirmedBySigner, state: "pending" as const };
        },
        async isClassDeclared() {
          return options.classDeclared ?? true;
        },
      },
      async submitDeclareTransaction(input) {
        declared.push(input);
        return { classHash: MULTISIG_CLASS_HASH, transactionHash: "0xdec" };
      },
      async submitAccountDeployment() {
        return { transactionHash: "0x7de" };
      },
      async submitErc20Transfer() {
        return {
          call: { calldata: [], contractAddress: HARNESS_TARGET, entrypoint: "transfer" },
          transactionHash: "0x7ab",
        };
      },
      async submitInvokeTransaction(input) {
        invokeCalls.push(input.calls);
        submittedAccounts.push(input.account.id);
        if (options.submitInvoke) {
          const result = await options.submitInvoke(input.calls);
          return { calls: input.calls, transactionHash: result.transactionHash };
        }
        return { calls: input.calls, transactionHash: HARNESS_SUBMIT_HASH };
      },
    },
    session,
  });
  return {
    balanceReads,
    declared,
    estimatedCalls,
    handler,
    invokeCalls,
    multisigStore,
    submittedAccounts,
  };
};
