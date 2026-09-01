/**
 * Shared background-dispatcher test fixtures: a capturing wallet stub plus
 * the canonical senders, accounts, and vault passphrase used by the
 * background-message suites. The stub keeps one vault object and answers both
 * `readVault` and `getGrantedAccounts` from it through the real
 * `grantedAccountIdsFor` policy, so a suite cannot end up with two disagreeing
 * notions of what the origin may see.
 */

import { grantedAccountIdsFor } from "@bramble/vault/origin-grants";
import type { Vault } from "@bramble/vault/schema";
import type {
  CreateVaultAccountInput,
  OriginGrantInput,
  SignHashInput,
  WalletStatus,
} from "@bramble/vault/service";
import type { AccountRef, DerivedAccountRef } from "@bramble/wallet-model/accounts";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";

/**
 * Single stub account used by the dispatcher suites.
 */
export const account: DerivedAccountRef = {
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

/**
 * A second stub account on the same network as {@link account}, at the next
 * address index, for suites that switch accounts. The stub vault's grant never
 * names it, so making it active disconnects the granted origin — the state the
 * re-prompt behaviour is built on.
 */
export const secondAccount: DerivedAccountRef = {
  ...account,
  address: "0xfeedface",
  derivation: { accountIndex: 0, addressIndex: 1, kind: "starknet-bip44" },
  id: "SN_SEPOLIA:0xfeedface",
};

/**
 * The one origin the stub vault holds a grant for.
 */
export const grantedOrigin = "https://example.com";

/**
 * Content-script sender for https://example.com pages.
 */
export const contentSender: RuntimeSender = { id: "extension-id", url: `${grantedOrigin}/app` };

/**
 * Extension-page sender accepted for privileged messages.
 */
export const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/popup.html",
};

/**
 * Vault passphrase the stub wallet accepts.
 */
export const vaultPassphrase = "correct horse battery staple";

const status: WalletStatus = {
  accountCount: 1,
  activeAccountId: account.id,
  hasVault: true,
  locked: true,
  ready: true,
};

/**
 * Wiring for {@link createWallet}, by key rather than by position. The capture
 * callbacks observe create, sign, and grant inputs. `accounts` widens the stub
 * vault and `activeAccountId` chooses which of them is active — it is called on
 * every read, so a suite can switch accounts between two messages and watch the
 * origin connect or disconnect.
 */
export type WalletStubOptions = {
  readonly accounts?: readonly AccountRef[];
  readonly activeAccountId?: () => string;
  readonly captureCreate?: (input: CreateVaultAccountInput) => void;
  readonly captureGrant?: (input: OriginGrantInput) => void;
  readonly captureSign?: (input: SignHashInput) => void;
};

/**
 * Builds the capturing wallet stub over a single stub vault.
 */
export const createWallet = (options: WalletStubOptions = {}) => {
  const accounts = options.accounts ?? [account];
  const vault = (): Vault => ({
    accounts,
    accountSecrets: [],
    activeAccountId: options.activeAccountId?.() ?? account.id,
    mnemonic: null,
    originGrants: [{ accountIds: [account.id], origin: grantedOrigin }],
    schemaVersion: 7,
    signingKeys: [{ accountId: account.id, privateKey: "0x123456" }],
  });
  return {
    async createAccount(input: CreateVaultAccountInput) {
      options.captureCreate?.(input);
      return account;
    },
    async addDerivedAccount() {
      return account;
    },
    async ensureNetworkAccount() {
      return account;
    },
    async importRawKeyAccount() {
      return account;
    },
    async previewAccount() {
      return account;
    },
    async validateMnemonic() {
      return true;
    },
    async getGrantedAccounts(origin: string) {
      const current = vault();
      return grantedAccountIdsFor(current, origin)
        .map((id) => current.accounts.find((stored) => stored.id === id))
        .filter((stored) => stored !== undefined);
    },
    async generateMnemonic() {
      return "habit hope tip crystal because grunt nation idea electric witness alert like";
    },
    async grantOrigin(input: OriginGrantInput) {
      options.captureGrant?.(input);
      return [account];
    },
    async readVault(passphrase: string) {
      if (passphrase !== vaultPassphrase) {
        throw new Error("bad passphrase");
      }
      return vault();
    },
    async setActiveAccount() {
      return account;
    },
    async signHash(input: SignHashInput) {
      options.captureSign?.(input);
      return {
        publicKey: "0xabc",
        r: "0x1",
        s: "0x2",
      };
    },
    async status() {
      return status;
    },
  };
};
