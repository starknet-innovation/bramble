/**
 * Shared background-dispatcher test fixtures: a capturing wallet stub plus
 * the canonical senders, accounts, and vault passphrase used by the
 * background-message suites. The stub keeps one vault object and answers both
 * `readVault` and `getGrantedAccounts` from it through the real
 * `grantedAccountIdsFor` policy, so a suite cannot end up with two disagreeing
 * notions of what the origin may see.
 */

import { WalletError } from "@bramble/core/errors";
import { grantedAccountIdsFor } from "@bramble/vault/origin-grants";
import type { Vault } from "@bramble/vault/schema";
import type {
  CreateKeyVaultInput,
  CreateVaultAccountInput,
  OriginGrantInput,
  SetActiveAccountInput,
  SignHashInput,
  WalletStatus,
} from "@bramble/vault/service";
import type {
  ListShadowAccountScopesInput,
  RecordShadowAccountScopeInput,
} from "@bramble/vault/service-types";
import {
  canonicalShadowAccountScope,
  type ShadowAccountScopeRef,
  shadowAccountScopesFor,
  withShadowAccountScope,
} from "@bramble/vault/shadow-account-scopes";
import type { AccountRef, DerivedAccountRef } from "@bramble/wallet-model/accounts";
import type {
  ExtensionIdentity,
  RuntimeSender,
} from "../../apps/extension/src/background/routing/senders";

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
/**
 * A Chromium extension identity, where the page origin really is derived from
 * the add-on id. Firefox is the case this shape exists for: there `runtime.id`
 * and the `moz-extension://<uuid>` page origin are unrelated, so production
 * must read the origin from the runtime rather than build it. Tests that need
 * that shape state both values explicitly instead of calling this.
 */
export const chromiumExtension = (id: string): ExtensionIdentity => ({
  id,
  origin: `chrome-extension://${id}`,
});

/** The extension identity the shared sender fixtures below belong to. */
export const testExtension: ExtensionIdentity = chromiumExtension("extension-id");

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
  readonly captureSetActiveAccount?: (input: SetActiveAccountInput) => void;
  readonly captureCreate?: (input: CreateVaultAccountInput) => void;
  readonly captureCreateKeyVault?: (input: CreateKeyVaultInput) => void;
  readonly captureGrant?: (input: OriginGrantInput) => void;
  readonly captureSign?: (input: SignHashInput) => void;
  /**
   * Public viewing key the stub says this wallet would register. Privacy checks
   * compare it with the pool. Defaults to `0x1`.
   */
  readonly viewingPublicKey?: string;
  /**
   * Shadow-account scope records the stub vault holds, shared with the suite so
   * it can read what a request recorded. Merged through the vault's own
   * helpers, so the stub keeps the real canonicalization and bounds.
   */
  readonly shadowAccountScopes?: { value: readonly ShadowAccountScopeRef[] };
};

/**
 * Builds the capturing wallet stub over a single stub vault.
 */
export const createWallet = (options: WalletStubOptions = {}) => {
  const accounts = options.accounts ?? [account];
  const scopes = options.shadowAccountScopes ?? { value: [] };
  const vault = (): Vault => ({
    accounts,
    accountSecrets: [],
    activeAccountId: options.activeAccountId?.() ?? account.id,
    importedSeeds: [],
    mnemonic: null,
    originGrants: [{ accountIds: [account.id], origin: grantedOrigin }],
    schemaVersion: 12,
    shadowAccountScopes: scopes.value,
    signingKeys: [{ accountId: account.id, privateKey: "0x123456" }],
  });
  return {
    async createAccount(input: CreateVaultAccountInput) {
      options.captureCreate?.(input);
      return account;
    },
    async createKeyVault(input: CreateKeyVaultInput) {
      options.captureCreateKeyVault?.(input);
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
    async previewImportedStrk20ViewingPublicKey() {
      return { address: account.address, viewingPublicKey: "0x1" };
    },
    async previewImportedAccount() {
      return account;
    },
    async previewStoredStrk20ViewingPublicKey() {
      return options.viewingPublicKey ?? "0x1";
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
    async recordShadowAccountScope({
      vaultPassphrase: passphrase,
      ...input
    }: RecordShadowAccountScopeInput) {
      if (passphrase !== vaultPassphrase) {
        throw new Error("bad passphrase");
      }
      const scope = canonicalShadowAccountScope(input);
      const next = scope ? withShadowAccountScope(scopes.value, scope) : null;
      if (!next) {
        throw new WalletError("shadow account record limit reached");
      }
      scopes.value = next;
    },
    async canRecordShadowAccountScope({
      vaultPassphrase: passphrase,
      ...input
    }: RecordShadowAccountScopeInput) {
      if (passphrase !== vaultPassphrase) {
        throw new Error("bad passphrase");
      }
      const scope = canonicalShadowAccountScope(input);
      return scope !== null && withShadowAccountScope(scopes.value, scope) !== null;
    },
    async listShadowAccountScopes(input: ListShadowAccountScopesInput) {
      return shadowAccountScopesFor(
        scopes.value,
        input.accountId,
        input.chainId,
        input.poolAddress,
      );
    },
    async readVault(passphrase: string) {
      if (passphrase !== vaultPassphrase) {
        throw new Error("bad passphrase");
      }
      return vault();
    },
    async setActiveAccount(input: SetActiveAccountInput) {
      options.captureSetActiveAccount?.(input);
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
