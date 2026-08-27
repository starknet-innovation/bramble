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

import type { AccountDerivationInput } from "@mc-wallet/vault/accounts";
import type { NostrApplicationData } from "@mc-wallet/vault/kms-port";
import type { Vault } from "@mc-wallet/vault/schema";
import type {
  AddDerivedAccountInput,
  AddLedgerAccountInput,
  AddMobilePqAccountInput,
  ConnectedSite,
  CreateLedgerVaultInput,
  CreateVaultAccountInput,
  DeriveLedgerAccountsInput,
  EnsureNetworkAccountInput,
  ImportRawKeyAccountInput,
  OpenNostrApplicationDataBatchInput,
  OpenNostrApplicationDataInput,
  OriginGrantInput,
  RevokeOriginInput,
  SetActiveAccountInput,
  SignHashInput,
  WalletStatus as VaultStatus,
  WalletVaultService,
  WrapNostrApplicationDataBatchInput,
  WrapNostrApplicationDataInput,
} from "@mc-wallet/vault/service";
import type { RecoverVaultAccountsInput } from "@mc-wallet/vault/service-types";
import type {
  AccountRef,
  LedgerAccountRef,
  MobilePqAccountRef,
} from "@mc-wallet/wallet-model/accounts";
import type { StarkSignature } from "@mc-wallet/wallet-model/signing";

/**
 * Narrow wallet service surface consumed by background message dispatch.
 */
export type WalletStatusReader = {
  readonly addDerivedAccount: (input: AddDerivedAccountInput) => Promise<AccountRef>;
  /** Stores a keyless Ledger account; optional only for partial test stubs. */
  readonly addLedgerAccount?: (input: AddLedgerAccountInput) => Promise<LedgerAccountRef>;
  /** Enrolls a paired post-quantum device; optional only for partial test stubs. */
  readonly addMobilePqAccount?: (input: AddMobilePqAccountInput) => Promise<MobilePqAccountRef>;
  readonly createAccount: (input: CreateVaultAccountInput) => Promise<AccountRef>;
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
  /** Derives public metadata without writing; optional only for partial test stubs. */
  readonly previewAccount?: (input: AccountDerivationInput) => Promise<AccountRef>;
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
    async addMobilePqAccount(input) {
      return (await required()).addMobilePqAccount(input);
    },
    async createAccount(input) {
      return (await required()).createAccount(input);
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
    async previewAccount(input) {
      return (await required()).previewAccount(input);
    },
    async recoverAccounts(input) {
      return (await required()).recoverAccounts(input);
    },
    async validateMnemonic(mnemonic) {
      return (await required()).validateMnemonic(mnemonic);
    },
    async readVault(vaultPassphrase) {
      return (await required()).readVault(vaultPassphrase);
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
