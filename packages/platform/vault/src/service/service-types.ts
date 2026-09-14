/**
 * Privileged wallet vault-service type surface. Split from `vault-service.ts` so
 * the implementation stays within the file-size budget; the service module
 * re-exports these so existing importers are unaffected. Types only — no logic,
 * no secrets held here (field names describing secret-carrying inputs are the
 * boundary this module documents).
 */

import type { ConnectedSite } from "@mc-wallet/core/origin";
import type {
  AccountContractType,
  AccountRef,
  DerivedAccountRef,
  ImportedAccountRef,
  LedgerAccountRef,
  LedgerPubKeyEntry,
} from "@mc-wallet/wallet-model/accounts";
import type { StarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import type { StarkSignature } from "@mc-wallet/wallet-model/signing";
import type { AccountDerivationInput } from "../accounts/accounts";
import type { NostrApplicationData } from "../kms-port";
import type { Vault } from "../schema/schema";
import type { RecoverVaultAccountsInput } from "./recovery";

/** Atomic recovery input re-exported for privileged runtime boundaries. */
export type { RecoverVaultAccountsInput } from "./recovery";

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

/** Public application payload encrypted to one Nostr recipient inside Krusty. */
export type WrapNostrApplicationDataInput = {
  readonly content: string;
  readonly identifier: string;
  readonly recipientPublicKey: string;
  readonly vaultPassphrase: string;
};

/** Untrusted NIP-59 event opened only after Krusty authenticates it. */
export type OpenNostrApplicationDataInput = {
  readonly eventJson: string;
  readonly vaultPassphrase: string;
};

/** Bounded Nostr inbox batch opened under one vault snapshot and live session. */
export type OpenNostrApplicationDataBatchInput = {
  readonly eventJsons: readonly string[];
  readonly isAuthorized: () => boolean;
  readonly vaultPassphrase: string;
};

/** Bounded recipient batch wrapped under one vault snapshot and live session. */
export type WrapNostrApplicationDataBatchInput = {
  readonly isAuthorized: () => boolean;
  readonly items: readonly Omit<WrapNostrApplicationDataInput, "vaultPassphrase">[];
  readonly vaultPassphrase: string;
};

/**
 * Origin grant input for account access permissions.
 */
export type OriginGrantInput = {
  readonly accountId?: string;
  /** Live capability check supplied by the privileged session coordinator. */
  readonly isAuthorized?: () => boolean;
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
 * Connected-site DTO re-exported from the shared runtime protocol boundary.
 */
export type { ConnectedSite } from "@mc-wallet/core/origin";

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
 *
 * `accountIndex` targets one specific HD position and defaults to the lowest
 * unused one. Restoring a phrase needs the explicit form: a wallet whose
 * accounts sit at 0, 3 and 7 cannot be rebuilt by repeatedly taking the lowest
 * free index without also creating the unused positions between them.
 */
export type AddDerivedAccountInput = {
  readonly accountContractType: AccountContractType;
  readonly networkId: StarknetNetworkId;
  readonly vaultPassphrase: string;
};

/**
 * Input for importing a standalone account from a raw Starknet private key. The
 * key is validated and routed to the encrypted vault; it is never persisted in
 * plain preferences or logged.
 */
export type ImportRawKeyAccountInput = {
  readonly accountContractType: AccountContractType;
  readonly deploymentSalt?: string;
  readonly networkId: StarknetNetworkId;
  readonly privateKey: string;
  readonly vaultPassphrase: string;
};

/**
 * Input for storing a keyless Ledger account from a device-provided public key.
 * No key material is accepted or retained; the device signs every transaction.
 */
export type AddLedgerAccountInput = {
  readonly accountContractType: AccountContractType;
  readonly accountIndex: number;
  readonly deploymentSalt?: string;
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
 * Background-only input for retaining a Ledger-derived STRK20 viewing key.
 * The future hardware ceremony must produce the key inside trusted extension
 * code; no provider or UI message accepts this secret-bearing shape.
 */
export type StoreLedgerStrk20ViewingKeyInput = {
  readonly accountId: string;
  readonly chainId: string;
  readonly poolAddress: string;
  readonly vaultPassphrase: string;
  readonly viewingKey: string;
};

/**
 * Exact account/chain/pool scope whose retained Ledger viewing key is removed.
 */
export type ForgetLedgerStrk20ViewingKeyInput = Omit<
  StoreLedgerStrk20ViewingKeyInput,
  "viewingKey"
>;

/**
 * Background-only input for the Ledger viewing-key ceremony. Carries no secret:
 * `sign` is the caller's device round-trip, which receives the message hash the
 * software derivation would have signed and returns the device's `(r, s)` — the
 * key is folded and written inside the vault boundary and never handed back.
 */
export type DeriveLedgerStrk20ViewingKeyInput = {
  readonly accountId: string;
  readonly chainId: string;
  readonly poolAddress: string;
  readonly sign: (messageHash: string) => Promise<StarkSignature>;
  readonly vaultPassphrase: string;
};

/**
 * Input for deriving addresses for a batch of enumerated Ledger (index, public
 * key) pairs to build the account picker. A public-key derivation only — it
 * reads no secrets and writes nothing to the vault.
 */
export type DeriveLedgerAccountsInput = {
  readonly accountContractType: AccountContractType;
  readonly deploymentSalt?: string;
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
   * Resolves a domain-separated STRK20 viewing key inside the encrypted vault
   * boundary. Software accounts derive lazily; Ledger accounts require an
   * exact retained chain/pool-scoped key.
   */
  readonly deriveStrk20ViewingKey: (input: {
    readonly accountId: string;
    readonly chainId: string;
    readonly poolAddress: string;
    readonly vaultPassphrase: string;
  }) => Promise<string>;
  /**
   * Runs the Ledger viewing-key ceremony for one scope and retains the result.
   * Returns nothing: the key is folded and written inside the vault boundary, so
   * no caller can observe it. Idempotent per scope — re-running replaces that
   * scope's key and leaves every other account and pool untouched.
   */
  readonly deriveLedgerStrk20ViewingKey: (
    input: DeriveLedgerStrk20ViewingKeyInput,
  ) => Promise<void>;
  /** Derives the wallet-level public Nostr identity without exposing its secret. */
  readonly nostrPublicKey: (vaultPassphrase: string) => Promise<string>;
  /** Opens and authenticates one NIP-59 application event inside Krusty. */
  readonly openNostrApplicationData: (
    input: OpenNostrApplicationDataInput,
  ) => Promise<NostrApplicationData>;
  /** Opens a bounded batch once; malformed events become null and authorization aborts the batch. */
  readonly openNostrApplicationDataBatch: (
    input: OpenNostrApplicationDataBatchInput,
  ) => Promise<readonly (NostrApplicationData | null)[]>;
  readonly ensureNetworkAccount: (input: EnsureNetworkAccountInput) => Promise<AccountRef>;
  /** Removes one retained Ledger viewing-key scope without returning its value. */
  readonly forgetLedgerStrk20ViewingKey: (
    input: ForgetLedgerStrk20ViewingKeyInput,
  ) => Promise<boolean>;
  readonly generateMnemonic: () => Promise<string>;
  readonly importRawKeyAccount: (input: ImportRawKeyAccountInput) => Promise<ImportedAccountRef>;
  /**
   * Derives public account metadata through Krusty without persisting a vault or
   * returning key material. Invalid derivation input fails closed.
   */
  readonly previewAccount: (input: AccountDerivationInput) => Promise<DerivedAccountRef>;
  /**
   * Checks a recovery phrase through Krusty only. Returns false for an invalid
   * phrase and never echoes the input; fails closed when KMS is unavailable.
   */
  readonly validateMnemonic: (mnemonic: string) => Promise<boolean>;
  /** Creates one recipient-specific NIP-59 event inside Krusty. */
  readonly wrapNostrApplicationData: (input: WrapNostrApplicationDataInput) => Promise<string>;
  /** Wraps a bounded recipient batch once; individual Krusty failures become null. */
  readonly wrapNostrApplicationDataBatch: (
    input: WrapNostrApplicationDataBatchInput,
  ) => Promise<readonly (string | null)[]>;
  readonly grantOrigin: (input: OriginGrantInput) => Promise<readonly AccountRef[]>;
  /**
   * The wallet's active account when the origin's grant covers it, per
   * `grantedAccountIdsFor` — so at most one account, never the whole grant.
   * Empty when the origin holds no grant, no account is active, or the grant
   * does not cover the active one: a stored grant alone never exposes an
   * account the user has switched away from. Rejects an invalid origin.
   */
  readonly getGrantedAccounts: (
    origin: string,
    vaultPassphrase: string,
  ) => Promise<readonly AccountRef[]>;
  readonly readVault: (vaultPassphrase: string) => Promise<Vault>;
  /** Restores a confirmed bounded set in one encrypted-vault commit. */
  readonly recoverAccounts: (
    input: RecoverVaultAccountsInput,
  ) => Promise<readonly DerivedAccountRef[]>;
  readonly revokeOrigin: (input: RevokeOriginInput) => Promise<readonly ConnectedSite[]>;
  /**
   * Finds the HD accounts a recovery phrase already has on chain, using the
   * injected `probe` for every chain answer. Returns public account metadata only
   * and persists nothing — the caller decides which candidates to add.
   *
   * Supply `mnemonic` to scan a phrase being recovered, before any vault exists;
   * supply `vaultPassphrase` instead to scan the phrase an existing vault already
   * holds. Exactly one source is needed, and neither is ever returned.
   */
  readonly setActiveAccount: (input: SetActiveAccountInput) => Promise<AccountRef>;
  readonly signHash: (input: SignHashInput) => Promise<StarkSignature>;
  readonly status: () => Promise<WalletStatus>;
  /**
   * Persists a validated Ledger viewing key only inside encrypted account
   * secrets. This is intentionally absent from extension message surfaces.
   */
  readonly storeLedgerStrk20ViewingKey: (input: StoreLedgerStrk20ViewingKeyInput) => Promise<void>;
};
