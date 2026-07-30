/**
 * Privileged wallet vault-service type surface. Split from `vault-service.ts` so
 * the implementation stays within the file-size budget; the service module
 * re-exports these so existing importers are unaffected. Types only — no logic,
 * no secrets held here (field names describing secret-carrying inputs are the
 * boundary this module documents).
 */
import type { StarkSignature } from "../crypto/krusty";
import type { StarknetNetworkId } from "../starknet/networks";
import type {
  AccountRef,
  DerivedAccountRef,
  ImportedAccountRef,
  LedgerAccountRef,
  Vault,
} from "../storage/vault-schema";
import type { AccountDerivationInput, LedgerPubKeyEntry } from "./accounts";

/**
 * Public wallet status shown to popup and provider callers.
 */
export type WalletStatus = {
  readonly accountCount: number;
  readonly activeAccountId: string | null;
  readonly hasVault: boolean;
  readonly locked: boolean;
  readonly ready: boolean;
};

/**
 * Account creation input including the vault encryption passphrase.
 */
export type CreateVaultAccountInput = AccountDerivationInput & {
  readonly vaultPassphrase: string;
};

/**
 * Privileged hash-signing input.
 */
export type SignHashInput = {
  readonly accountId?: string;
  readonly messageHash: string;
  readonly vaultPassphrase: string;
};

/**
 * Origin grant input for account access permissions.
 */
export type OriginGrantInput = {
  readonly accountId?: string;
  readonly origin: string;
  readonly vaultPassphrase: string;
};

/**
 * Origin revocation input for the connected-sites permissions manager.
 */
export type RevokeOriginInput = {
  readonly origin: string;
  readonly vaultPassphrase: string;
};

/**
 * A site with a persisted origin grant plus how many accounts it can see.
 */
export type ConnectedSite = {
  readonly accountCount: number;
  readonly origin: string;
};

/**
 * Active account selection input.
 */
export type SetActiveAccountInput = {
  readonly accountId: string;
  readonly vaultPassphrase: string;
};

/**
 * Input for deriving the selected wallet account onto another Starknet network.
 */
export type EnsureNetworkAccountInput = {
  readonly networkId: StarknetNetworkId;
  readonly vaultPassphrase: string;
};

/**
 * Input for adding a freshly derived account on a network using the vault's
 * retained recovery phrase.
 */
export type AddDerivedAccountInput = {
  readonly networkId: StarknetNetworkId;
  readonly vaultPassphrase: string;
};

/**
 * Input for importing a standalone account from a raw Starknet private key. The
 * key is validated and routed to the encrypted vault; it is never persisted in
 * plain preferences or logged.
 */
export type ImportRawKeyAccountInput = {
  readonly networkId: StarknetNetworkId;
  readonly privateKey: string;
  readonly vaultPassphrase: string;
};

/**
 * Input for storing a keyless Ledger account from a device-provided public key.
 * No key material is accepted or retained; the device signs every transaction.
 */
export type AddLedgerAccountInput = {
  readonly accountIndex: number;
  readonly eip2645application?: string;
  readonly networkId: StarknetNetworkId;
  readonly publicKeyX: string;
  readonly vaultPassphrase: string;
};

/**
 * Input for creating a brand-new mnemonic-less vault whose first account is a
 * keyless Ledger account. The user still sets an unlock passphrase (it encrypts
 * the account registry and settings); no seed or private key is generated, shown,
 * or retained. Used only on first run — creating over an existing vault fails.
 */
export type CreateLedgerVaultInput = AddLedgerAccountInput;

/**
 * Input for deriving addresses for a batch of enumerated Ledger (index, public
 * key) pairs to build the account picker. A public-key derivation only — it
 * reads no secrets and writes nothing to the vault.
 */
export type DeriveLedgerAccountsInput = {
  readonly entries: readonly LedgerPubKeyEntry[];
  readonly networkId: StarknetNetworkId;
};

/**
 * Re-authenticated secret export for the active account. Returned only to the
 * privileged reveal flow and never persisted or logged. `mnemonic` is `null`
 * when the vault predates recovery-phrase retention.
 */
export type RevealedSecrets = {
  readonly mnemonic: string | null;
  readonly privateKey: string;
};

/**
 * Privileged encrypted-vault wallet service surface.
 */
export type WalletVaultService = {
  readonly addDerivedAccount: (input: AddDerivedAccountInput) => Promise<DerivedAccountRef>;
  readonly addLedgerAccount: (input: AddLedgerAccountInput) => Promise<LedgerAccountRef>;
  readonly createAccount: (input: CreateVaultAccountInput) => Promise<DerivedAccountRef>;
  readonly createLedgerVault: (input: CreateLedgerVaultInput) => Promise<LedgerAccountRef>;
  readonly deriveLedgerAccounts: (
    input: DeriveLedgerAccountsInput,
  ) => Promise<readonly LedgerAccountRef[]>;
  /**
   * Derives a domain-separated STRK20 viewing key from encrypted account key
   * material. Keyless accounts fail closed and the result is never persisted.
   */
  readonly deriveStrk20ViewingKey: (input: {
    readonly accountId: string;
    readonly vaultPassphrase: string;
  }) => Promise<string>;
  readonly ensureNetworkAccount: (input: EnsureNetworkAccountInput) => Promise<AccountRef>;
  readonly generateMnemonic: () => Promise<string>;
  readonly importRawKeyAccount: (input: ImportRawKeyAccountInput) => Promise<ImportedAccountRef>;
  /**
   * Derives public account metadata through Krusty without persisting a vault or
   * returning key material. Invalid derivation input fails closed.
   */
  readonly previewAccount: (input: AccountDerivationInput) => Promise<DerivedAccountRef>;
  readonly grantOrigin: (input: OriginGrantInput) => Promise<readonly AccountRef[]>;
  readonly getGrantedAccounts: (
    origin: string,
    vaultPassphrase: string,
  ) => Promise<readonly AccountRef[]>;
  readonly readVault: (vaultPassphrase: string) => Promise<Vault>;
  readonly revokeOrigin: (input: RevokeOriginInput) => Promise<readonly ConnectedSite[]>;
  readonly setActiveAccount: (input: SetActiveAccountInput) => Promise<AccountRef>;
  readonly signHash: (input: SignHashInput) => Promise<StarkSignature>;
  readonly status: () => Promise<WalletStatus>;
};
