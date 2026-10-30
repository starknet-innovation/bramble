/**
 * The narrow wallet service surface background message dispatch consumes, and
 * the adapter that produces it from the privileged vault service (which may
 * have failed to construct).
 *
 * The contract and its only implementation live together so a method cannot be
 * added to one without the other. Every method fails closed with "wallet
 * unavailable" when the service is null, except `status`, which reports an
 * unavailable-but-defined status so the UI can render a locked shell instead of
 * erroring. Holds no state and no secrets; it only forwards already-validated
 * inputs to the service behind the vault boundary.
 */

import type { AccountDerivationInput } from "@bramble/vault/accounts";
import type { NostrApplicationData } from "@bramble/vault/kms-port";
import type { Vault } from "@bramble/vault/schema";
import type {
  AddDerivedAccountInput,
  AddLedgerAccountInput,
  ConnectedSite,
  CreateKeyVaultInput,
  CreateLedgerVaultInput,
  CreateVaultAccountInput,
  DeriveLedgerAccountsInput,
  EnsureNetworkAccountInput,
  ImportRawKeyAccountInput,
  OpenNostrApplicationDataBatchInput,
  OpenNostrApplicationDataInput,
  OriginGrantInput,
  PreviewImportedAccountInput,
  RevokeOriginInput,
  SetActiveAccountInput,
  SignHashInput,
  WalletStatus as VaultStatus,
  WalletVaultService,
  WrapNostrApplicationDataBatchInput,
  WrapNostrApplicationDataInput,
} from "@bramble/vault/service";
import type {
  ListShadowAccountScopesInput,
  RecordShadowAccountScopeInput,
  RecoverVaultAccountsInput,
} from "@bramble/vault/service-types";
import type { ShadowAccountScopeRef } from "@bramble/vault/shadow-account-scopes";
import type { AccountRef, LedgerAccountRef } from "@bramble/wallet-model/accounts";
import type { StarkSignature } from "@bramble/wallet-model/signing";

/**
 * Narrow wallet service surface consumed by background message dispatch.
 */
export type WalletStatusReader = {
  readonly addDerivedAccount: (input: AddDerivedAccountInput) => Promise<AccountRef>;
  /** Stores a keyless Ledger account; optional only for partial test stubs. */
  readonly addLedgerAccount?: (input: AddLedgerAccountInput) => Promise<LedgerAccountRef>;
  readonly createAccount: (input: CreateVaultAccountInput) => Promise<AccountRef>;
  /** Creates a phrase-less vault from one raw key; fails closed over an existing vault. */
  readonly createKeyVault?: (input: CreateKeyVaultInput) => Promise<AccountRef>;
  /** Creates a mnemonic-less Ledger vault; fails closed over an existing vault. */
  readonly createLedgerVault?: (input: CreateLedgerVaultInput) => Promise<LedgerAccountRef>;
  /** Derives Ledger picker candidates; optional only for partial test stubs. */
  readonly deriveLedgerAccounts?: (
    input: DeriveLedgerAccountsInput,
  ) => Promise<readonly LedgerAccountRef[]>;
  /**
   * Derives the account-scoped STRK20 viewing key inside the vault boundary.
   * Optional only for partial test stubs; production fails closed when absent.
   */
  readonly deriveStrk20ViewingKey?: (input: {
    readonly accountId: string;
    readonly chainId: string;
    readonly poolAddress: string;
    readonly vaultPassphrase: string;
  }) => Promise<string>;
  readonly ensureNetworkAccount: (input: EnsureNetworkAccountInput) => Promise<AccountRef>;
  readonly generateMnemonic: () => Promise<string>;
  /** Derives only the wallet-level public Nostr identity. */
  readonly nostrPublicKey?: (vaultPassphrase: string) => Promise<string>;
  /** Opens one authenticated NIP-59 application event inside Krusty. */
  readonly openNostrApplicationData?: (
    input: OpenNostrApplicationDataInput,
  ) => Promise<NostrApplicationData>;
  /** Opens a bounded Nostr inbox with one encrypted-vault read. */
  readonly openNostrApplicationDataBatch?: (
    input: OpenNostrApplicationDataBatchInput,
  ) => Promise<readonly (NostrApplicationData | null)[]>;
  /**
   * Imports an account from a raw private key. Optional on this narrow dispatch
   * type so partial test stubs stay valid; the wired vault service always
   * provides it.
   */
  readonly importRawKeyAccount?: (input: ImportRawKeyAccountInput) => Promise<AccountRef>;
  /** Imports selected accounts from another phrase; optional only for partial test stubs. */
  readonly importSeedAccounts?: (
    input: RecoverVaultAccountsInput,
  ) => Promise<readonly AccountRef[]>;
  /** Derives public metadata without writing; optional only for partial test stubs. */
  readonly previewAccount?: (input: AccountDerivationInput) => Promise<AccountRef>;
  /** Public viewing key a phrase account would register; optional only for partial test stubs. */
  readonly previewStrk20ViewingPublicKey?: (
    input: AccountDerivationInput & { readonly chainId: string; readonly poolAddress: string },
  ) => Promise<string>;
  /** Raw-key import address and viewing public key; optional only for partial test stubs. */
  readonly previewImportedStrk20ViewingPublicKey?: WalletVaultService["previewImportedStrk20ViewingPublicKey"];
  /**
   * Public viewing key a stored account would register. Optional only for
   * partial test stubs; a privacy check without it retries rather than guessing.
   */
  readonly previewStoredStrk20ViewingPublicKey?: WalletVaultService["previewStoredStrk20ViewingPublicKey"];
  /** Derives a raw key's public account without writing; optional only for partial test stubs. */
  readonly previewImportedAccount?: (input: PreviewImportedAccountInput) => Promise<AccountRef>;
  /**
   * Records a used shadow-account scope in the encrypted vault (#443). Optional
   * only for partial test stubs; every shadow-account path fails closed
   * without it, because an unrecorded shadow account cannot be recovered.
   */
  readonly recordShadowAccountScope?: (input: RecordShadowAccountScopeInput) => Promise<void>;
  /**
   * Whether a scope record would be accepted now, without writing. Optional
   * only for partial test stubs; without it the request is still refused at
   * record time, after approval.
   */
  readonly canRecordShadowAccountScope?: (input: RecordShadowAccountScopeInput) => Promise<boolean>;
  /** Lists recorded shadow-account scopes; optional only for partial test stubs. */
  readonly listShadowAccountScopes?: (
    input: ListShadowAccountScopesInput,
  ) => Promise<readonly ShadowAccountScopeRef[]>;
  /** Atomically restores a confirmed set of phrase-derived accounts. */
  readonly recoverAccounts?: (input: RecoverVaultAccountsInput) => Promise<readonly AccountRef[]>;
  /**
   * Krusty mnemonic check for onboarding. Optional only for partial test stubs;
   * production fails closed when absent.
   */
  readonly validateMnemonic?: (mnemonic: string) => Promise<boolean>;
  readonly getGrantedAccounts: (
    origin: string,
    vaultPassphrase: string,
  ) => Promise<readonly AccountRef[]>;
  readonly grantOrigin: (input: OriginGrantInput) => Promise<readonly AccountRef[]>;
  readonly readVault: (vaultPassphrase: string) => Promise<Vault>;
  /**
   * Accepts a vault awaiting recovery; see `WalletVaultService.recoverUnverifiedVault`.
   * Optional only for partial test stubs; the handler fails closed without it.
   */
  readonly recoverUnverifiedVault?: (vaultPassphrase: string) => Promise<void>;
  /** Removes origin grants; optional only for partial test stubs. */
  readonly revokeOrigin?: (input: RevokeOriginInput) => Promise<readonly ConnectedSite[]>;
  readonly setActiveAccount: (input: SetActiveAccountInput) => Promise<AccountRef>;
  readonly signHash: (input: SignHashInput) => Promise<StarkSignature>;
  readonly status: () => Promise<VaultStatus>;
  /** Creates one recipient-specific NIP-59 event inside Krusty. */
  readonly wrapNostrApplicationData?: (input: WrapNostrApplicationDataInput) => Promise<string>;
  /** Creates a bounded recipient batch with one encrypted-vault read. */
  readonly wrapNostrApplicationDataBatch?: (
    input: WrapNostrApplicationDataBatchInput,
  ) => Promise<readonly (string | null)[]>;
};

/**
 * Wraps the (possibly null) vault service in the dispatcher's reader interface.
 */
export const createWalletReader = (
  service: Promise<WalletVaultService | null>,
): WalletStatusReader => {
  const required = async (): Promise<WalletVaultService> => {
    const resolved = await service;
    if (!resolved) {
      throw new Error("wallet unavailable");
    }
    return resolved;
  };
  return {
    async addDerivedAccount(input) {
      return (await required()).addDerivedAccount(input);
    },
    async addLedgerAccount(input) {
      return (await required()).addLedgerAccount(input);
    },
    async createAccount(input) {
      return (await required()).createAccount(input);
    },
    async createKeyVault(input) {
      return (await required()).createKeyVault(input);
    },
    async createLedgerVault(input) {
      return (await required()).createLedgerVault(input);
    },
    async deriveLedgerAccounts(input) {
      return (await required()).deriveLedgerAccounts(input);
    },
    async deriveStrk20ViewingKey(input) {
      return (await required()).deriveStrk20ViewingKey(input);
    },
    async ensureNetworkAccount(input) {
      return (await required()).ensureNetworkAccount(input);
    },
    async generateMnemonic() {
      return (await required()).generateMnemonic();
    },
    async nostrPublicKey(vaultPassphrase) {
      return (await required()).nostrPublicKey(vaultPassphrase);
    },
    async openNostrApplicationData(input) {
      return (await required()).openNostrApplicationData(input);
    },
    async openNostrApplicationDataBatch(input) {
      return (await required()).openNostrApplicationDataBatch(input);
    },
    async getGrantedAccounts(origin, vaultPassphrase) {
      return (await required()).getGrantedAccounts(origin, vaultPassphrase);
    },
    async grantOrigin(input) {
      return (await required()).grantOrigin(input);
    },
    async importRawKeyAccount(input) {
      return (await required()).importRawKeyAccount(input);
    },
    async importSeedAccounts(input) {
      return (await required()).importSeedAccounts(input);
    },
    async previewAccount(input) {
      return (await required()).previewAccount(input);
    },
    async previewStrk20ViewingPublicKey(input) {
      return (await required()).previewStrk20ViewingPublicKey(input);
    },
    async previewImportedStrk20ViewingPublicKey(input) {
      return (await required()).previewImportedStrk20ViewingPublicKey(input);
    },
    async previewStoredStrk20ViewingPublicKey(input) {
      return (await required()).previewStoredStrk20ViewingPublicKey(input);
    },
    async previewImportedAccount(input) {
      return (await required()).previewImportedAccount(input);
    },
    async recoverAccounts(input) {
      return (await required()).recoverAccounts(input);
    },
    async recordShadowAccountScope(input) {
      return (await required()).recordShadowAccountScope(input);
    },
    async canRecordShadowAccountScope(input) {
      return (await required()).canRecordShadowAccountScope(input);
    },
    async listShadowAccountScopes(input) {
      return (await required()).listShadowAccountScopes(input);
    },
    async validateMnemonic(mnemonic) {
      return (await required()).validateMnemonic(mnemonic);
    },
    async readVault(vaultPassphrase) {
      return (await required()).readVault(vaultPassphrase);
    },
    async recoverUnverifiedVault(vaultPassphrase) {
      return (await required()).recoverUnverifiedVault(vaultPassphrase);
    },
    async revokeOrigin(input) {
      return (await required()).revokeOrigin(input);
    },
    async setActiveAccount(input) {
      return (await required()).setActiveAccount(input);
    },
    async signHash(input) {
      return (await required()).signHash(input);
    },
    async status() {
      const resolved = await service;
      return resolved
        ? resolved.status()
        : { accountCount: 0, activeAccountId: null, hasVault: false, locked: true, ready: false };
    },
    async wrapNostrApplicationData(input) {
      return (await required()).wrapNostrApplicationData(input);
    },
    async wrapNostrApplicationDataBatch(input) {
      return (await required()).wrapNostrApplicationDataBatch(input);
    },
  };
};
