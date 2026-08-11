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

import type { AccountRef, LedgerAccountRef } from "@mc-wallet/wallet-model/accounts";
import type { StarkSignature } from "@mc-wallet/wallet-model/signing";
import type { Vault } from "@mc-wallet/vault/schema";
import type { AccountDerivationInput } from "@mc-wallet/vault/accounts";
import type {
  AddDerivedAccountInput,
  AddLedgerAccountInput,
  ConnectedSite,
  CreateLedgerVaultInput,
  CreateVaultAccountInput,
  DeriveLedgerAccountsInput,
  DeriveLedgerStrk20ViewingKeyInput,
  EnsureNetworkAccountInput,
  ImportRawKeyAccountInput,
  OriginGrantInput,
  RevokeOriginInput,
  SetActiveAccountInput,
  SignHashInput,
  WalletStatus as VaultStatus,
  WalletVaultService,
} from "@mc-wallet/vault/service";

/**
 * Narrow wallet service surface consumed by background message dispatch.
 */
export type WalletStatusReader = {
  readonly addDerivedAccount: (input: AddDerivedAccountInput) => Promise<AccountRef>;
  /** Stores a keyless Ledger account; optional only for partial test stubs. */
  readonly addLedgerAccount?: (input: AddLedgerAccountInput) => Promise<LedgerAccountRef>;
  readonly createAccount: (input: CreateVaultAccountInput) => Promise<AccountRef>;
  /** Creates a mnemonic-less Ledger vault; fails closed over an existing vault. */
  readonly createLedgerVault?: (input: CreateLedgerVaultInput) => Promise<LedgerAccountRef>;
  /** Derives Ledger picker candidates; optional only for partial test stubs. */
  readonly deriveLedgerAccounts?: (
    input: DeriveLedgerAccountsInput,
  ) => Promise<readonly LedgerAccountRef[]>;
  /**
   * Runs the Ledger viewing-key ceremony and retains the result inside the vault
   * boundary. Returns nothing — the key is never handed back across this seam.
   * Optional only for partial test stubs; production fails closed when absent.
   */
  readonly deriveLedgerStrk20ViewingKey?: (
    input: DeriveLedgerStrk20ViewingKeyInput,
  ) => Promise<void>;
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
  /**
   * Imports an account from a raw private key. Optional on this narrow dispatch
   * type so partial test stubs stay valid; the wired vault service always
   * provides it.
   */
  readonly importRawKeyAccount?: (input: ImportRawKeyAccountInput) => Promise<AccountRef>;
  /** Derives public metadata without writing; optional only for partial test stubs. */
  readonly previewAccount?: (input: AccountDerivationInput) => Promise<AccountRef>;
  /**
   * Finds the HD accounts this vault's phrase already has on chain, using the
   * caller's `probe` for every chain answer. Returns public metadata only and
   * writes nothing. Optional so partial test stubs stay valid.
   */
  readonly scanSeedAccounts?: WalletVaultService["scanSeedAccounts"];
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
    async createLedgerVault(input) {
      return (await required()).createLedgerVault(input);
    },
    async deriveLedgerAccounts(input) {
      return (await required()).deriveLedgerAccounts(input);
    },
    async deriveLedgerStrk20ViewingKey(input) {
      return (await required()).deriveLedgerStrk20ViewingKey(input);
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
    async scanSeedAccounts(input) {
      return (await required()).scanSeedAccounts(input);
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
  };
};
