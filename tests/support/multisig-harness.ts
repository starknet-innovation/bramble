/**
 * Shared multisig message-test harness: a full wallet/RPC stub wired through
 * createMessageHandler with controllable multisig chain reads, so lifecycle
 * tests do not each re-declare ~140 lines of stubbing.
 */
import { createMessageHandler } from "../../src/background/messages";
import type { RuntimeSender } from "../../src/background/senders";
import { createUnlockSession } from "../../src/background/session";
import type { MultisigProposalStatus } from "../../src/starknet/multisig";
import { MULTISIG_CLASS_HASH } from "../../src/starknet/multisig-deploy";
import { memoryMultisigStore } from "../../src/storage/multisig-store";
import type { AccountRef, Vault } from "../../src/storage/vault-schema";

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

const vault = {
  accounts: [harnessAccount],
  activeAccountId: harnessAccount.id,
} as unknown as Vault;

const walletStub = {
  async addDerivedAccount() {
    return harnessAccount;
  },
  async createAccount() {
    return harnessAccount;
  },
  async ensureNetworkAccount() {
    return harnessAccount;
  },
  async getGrantedAccounts() {
    return [harnessAccount];
  },
  async generateMnemonic() {
    return "unused";
  },
  async grantOrigin() {
    return [harnessAccount];
  },
  async readVault() {
    return vault;
  },
  async setActiveAccount() {
    return harnessAccount;
  },
  async signHash() {
    return { publicKey: harnessAccount.publicKeyX, r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: harnessAccount.id,
      hasVault: true,
      locked: false,
      ready: false,
    };
  },
};

/**
 * Harness knobs. `proposalStatus` and `deploymentStatus` are consulted on
 * every chain read so tests can change the reported state (or start
 * throwing) between calls; `loadClass` supplies the bundled Sierra artifact
 * for the declare flow.
 */
export type MultisigHarnessOptions = {
  readonly classDeclared?: boolean;
  readonly contractAt?: boolean;
  readonly deploymentStatus?: () => boolean;
  readonly loadClass?: () => Promise<unknown>;
  readonly proposalStatus?: () => MultisigProposalStatus;
  readonly signers?: readonly string[];
};

/**
 * Builds a message handler with an unlocked session, an in-memory multisig
 * store, and capture arrays for submitted invokes and declares.
 */
export const makeMultisigHarness = (options: MultisigHarnessOptions = {}) => {
  const session = createUnlockSession();
  session.unlock("correct horse battery staple");
  const multisigStore = memoryMultisigStore();
  const invokeCalls: (readonly unknown[])[] = [];
  const declared: unknown[] = [];
  const handler = createMessageHandler(walletStub, "extension-id", {
    ...(options.loadClass ? { loadMultisigClass: options.loadClass } : {}),
    multisigStore,
    runtimeRpc: {
      async estimateInvokeFee() {
        return { overallFee: "1", unit: "FRI" };
      },
      async getDeploymentStatus() {
        return options.deploymentStatus?.() ?? options.contractAt ?? false;
      },
      async getNftOwner() {
        return harnessAccount.address;
      },
      async getTokenBalances() {
        return [];
      },
      async getTokenMetadata() {
        return { decimals: 18, name: "Ether", symbol: "ETH" };
      },
      async getTransactionStatuses() {
        return {};
      },
      multisig: {
        async computeTransactionId() {
          return HARNESS_TX_ID;
        },
        async getConfig() {
          return {
            quorum: 2,
            signers: options.signers ?? [harnessAccount.address, HARNESS_OTHER_SIGNER],
          };
        },
        async getProposalStatus() {
          return (
            options.proposalStatus?.() ?? {
              confirmations: 1,
              confirmedBySigner: false,
              state: "pending",
            }
          );
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
        return { calls: input.calls, transactionHash: "0x7cd" };
      },
    },
    session,
  });
  return { declared, handler, invokeCalls, multisigStore };
};
