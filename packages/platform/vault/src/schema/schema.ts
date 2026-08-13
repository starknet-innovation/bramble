/**
 * Versioned vault schema and validators for decrypted wallet state.
 */
import { hasOnlyKnownKeys, hasUniqueStrings, isJson, isRecord } from "@mc-wallet/core/json";
import { isWalletOrigin } from "@mc-wallet/core/origin";
import {
  type AccountRef,
  canonicalAccountId,
  canonicalAccountRef,
  canonicalLegacyAccountRef,
  isAccountId,
  isAccountRef,
  isLegacyAccountRef,
  type LegacyAccountRef,
} from "@mc-wallet/wallet-model/accounts";
import { canonicalFelt, isStarkPrivateKey } from "@mc-wallet/wallet-model/networks";
import { isMnemonicText } from "@mc-wallet/wallet-model/passphrase";
import {
  type AccountSecretRef,
  hasValidAccountSecretBindings,
  isAccountSecretRef,
} from "../accounts/account-secrets";

/**
 * Current vault schema version accepted by validators and writers.
 *
 * Version 6 records account-contract semantics explicitly. Version 5
 * canonicalized account identities and their dependent references.
 * Version 4 introduced optional account secrets separated from public
 * {@link AccountRef} metadata.
 */
export const CURRENT_SCHEMA_VERSION = 6;

/**
 * Encrypted-vault reference from an account id to its private key.
 */
export type SigningKeyRef = {
  readonly accountId: string;
  readonly privateKey: string;
};

/**
 * Origin permission grant scoped to selected account ids.
 */
export type OriginGrant = {
  readonly accountIds: readonly string[];
  readonly origin: string;
};

/**
 * Legacy vault schema without a retained recovery phrase. Only reachable
 * through migration; new writes always use the current schema.
 */
export type VaultV1 = {
  readonly accounts: readonly LegacyAccountRef[];
  readonly activeAccountId: string | null;
  readonly originGrants: readonly OriginGrant[];
  readonly schemaVersion: 1;
  readonly signingKeys: readonly SigningKeyRef[];
};

/**
 * Legacy schema-v2 vault, reachable only through migration. Its accounts are
 * key-backed only (`starknet-bip44` or `imported-raw-key`); a keyless Ledger
 * account is invalid at this version. `mnemonic` retains the recovery phrase
 * (null for vaults migrated from v1). New writes always use {@link VaultV4}.
 */
export type VaultV2 = {
  readonly accounts: readonly LegacyAccountRef[];
  readonly activeAccountId: string | null;
  readonly mnemonic: string | null;
  readonly originGrants: readonly OriginGrant[];
  readonly schemaVersion: 2;
  readonly signingKeys: readonly SigningKeyRef[];
};

/**
 * Legacy schema-v3 vault. Identical in shape to v2 but its accounts may
 * include the keyless {@link LedgerAccountRef} variant, so the account↔signingKey
 * bijection is relaxed to require a key for every non-Ledger account only.
 *
 * `mnemonic` is `null` when the vault retains no recovery phrase. That covers two
 * cases and needs no shape change beyond v2: a vault migrated from schema v1
 * (where the phrase was never stored, so its seed accounts stay signable through
 * their retained keys but phrase-dependent operations are read-only), and a
 * Ledger-only wallet created with no seed material at all. The phrase-coverage
 * rule is enforced at the mutation boundary, not the schema: `addDerivedAccount`
 * refuses to derive a new HD account when `mnemonic` is null (it has nothing to
 * derive from), and `createLedgerVault` only ever writes null over a fresh store.
 * The grandfathered legacy null-with-seed shape stays valid at this schema so
 * those v1-migrated wallets never fail closed — which is exactly why the coverage
 * rule cannot be a validator invariant.
 */
export type VaultV3 = {
  readonly accounts: readonly LegacyAccountRef[];
  readonly activeAccountId: string | null;
  readonly mnemonic: string | null;
  readonly originGrants: readonly OriginGrant[];
  readonly schemaVersion: 3;
  readonly signingKeys: readonly SigningKeyRef[];
};

/**
 * Current encrypted vault schema. Optional account secrets are deliberately
 * separate from {@link AccountRef}: account metadata is safe to project to the
 * UI and granted origins, while this collection never leaves the privileged
 * encrypted-vault boundary. An account has no record until it retains an
 * optional secret.
 */
export type VaultV4 = {
  readonly accounts: readonly LegacyAccountRef[];
  readonly accountSecrets: readonly AccountSecretRef[];
  readonly activeAccountId: string | null;
  readonly mnemonic: string | null;
  readonly originGrants: readonly OriginGrant[];
  readonly schemaVersion: 4;
  readonly signingKeys: readonly SigningKeyRef[];
};

/**
 * Current encrypted vault schema. Version 5 makes every account identity and
 * public-key felt canonical so aliases cannot survive as distinct records.
 */
export type VaultV5 = Omit<VaultV4, "schemaVersion"> & { readonly schemaVersion: 5 };

/**
 * Current encrypted vault schema. Every account carries explicit contract
 * semantics; historical accounts migrate deterministically to OpenZeppelin.
 */
export type VaultV6 = Omit<VaultV4, "accounts" | "schemaVersion"> & {
  readonly accounts: readonly AccountRef[];
  readonly schemaVersion: 6;
};

/**
 * Alias for the latest supported vault schema.
 */
export type Vault = VaultV6;

const isStoredAccountId = (value: unknown, canonical: boolean): value is string =>
  canonical ? isAccountId(value) : canonicalAccountId(value) !== null;

const isSigningKeyRef = (value: unknown, canonical: boolean): value is SigningKeyRef =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountId", "privateKey"]) &&
  isStoredAccountId(value["accountId"], canonical) &&
  typeof value["privateKey"] === "string" &&
  // The signing-scalar rule, not the wider non-zero-felt one: a stored key at or
  // above the curve order is not a key the signer can honour — it would be
  // reduced mod n and sign for a different account than the record names — so a
  // vault carrying one is refused rather than decrypted into use.
  isStarkPrivateKey(value["privateKey"]) &&
  (!canonical || canonicalFelt(value["privateKey"]) === value["privateKey"]);

const isOriginGrant = (value: unknown, canonical: boolean): value is OriginGrant =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountIds", "origin"]) &&
  Array.isArray(value["accountIds"]) &&
  value["accountIds"].length > 0 &&
  value["accountIds"].every((accountId) => isStoredAccountId(accountId, canonical)) &&
  typeof value["origin"] === "string" &&
  isWalletOrigin(value["origin"]);

/**
 * Creates a deterministic empty current vault.
 */
export const emptyVault = (): VaultV6 => ({
  accounts: [],
  accountSecrets: [],
  activeAccountId: null,
  mnemonic: null,
  originGrants: [],
  schemaVersion: CURRENT_SCHEMA_VERSION,
  signingKeys: [],
});

const isRetainedMnemonic = (value: unknown): value is string | null =>
  value === null || isMnemonicText(value);

// Relaxed account↔signingKey bijection: every signing key must map to an
// account, and every account must hold exactly one signing key UNLESS it is a
// keyless Ledger account, which must hold none. For key-backed-only vaults
// (v1/v2, where a Ledger account cannot appear) this is identical to a strict
// bijection. Extracted so the main validator stays within the complexity budget.
const hasValidKeyBindings = (
  accounts: readonly (AccountRef | LegacyAccountRef)[],
  signingKeys: readonly SigningKeyRef[],
): boolean =>
  signingKeys.every((key) => accounts.some((account) => account.id === key.accountId)) &&
  accounts.every(
    (account) =>
      signingKeys.some((key) => key.accountId === account.id) ===
      (account.derivation.kind !== "ledger"),
  );

const hasValidVaultReferences = (
  value: Record<string, unknown>,
  options: {
    readonly canonical: boolean;
    readonly currentAccounts: boolean;
    readonly ledgerAllowed: boolean;
  },
): boolean => {
  if (
    (!isStoredAccountId(value["activeAccountId"], options.canonical) &&
      value["activeAccountId"] !== null) ||
    !Array.isArray(value["accounts"]) ||
    !Array.isArray(value["originGrants"]) ||
    !Array.isArray(value["signingKeys"])
  ) {
    return false;
  }

  const accounts = value["accounts"];
  const originGrants = value["originGrants"];
  const signingKeys = value["signingKeys"];

  return (
    accounts.every(
      (account) =>
        (options.currentAccounts
          ? options.canonical
            ? isAccountRef(account)
            : canonicalAccountRef(account) !== null
          : options.canonical
            ? isLegacyAccountRef(account)
            : canonicalLegacyAccountRef(account) !== null) &&
        (options.ledgerAllowed || account.derivation.kind !== "ledger"),
    ) &&
    hasUniqueStrings(accounts.map((account) => account.id)) &&
    originGrants.every((grant) => isOriginGrant(grant, options.canonical)) &&
    hasUniqueStrings(originGrants.map((grant) => grant.origin)) &&
    originGrants.every((grant) => hasUniqueStrings(grant.accountIds)) &&
    originGrants.every((grant) =>
      grant.accountIds.every((accountId) => accounts.some((account) => account.id === accountId)),
    ) &&
    signingKeys.every((signingKey) => isSigningKeyRef(signingKey, options.canonical)) &&
    hasUniqueStrings(signingKeys.map((key) => key.accountId)) &&
    hasValidKeyBindings(accounts, signingKeys) &&
    (accounts.length === 0
      ? value["activeAccountId"] === null
      : value["activeAccountId"] !== null &&
        accounts.some((account) => account.id === value["activeAccountId"]))
  );
};

const hasValidCurrentVaultReferences = (
  value: Record<string, unknown>,
  options: { readonly canonical: boolean; readonly currentAccounts: boolean },
): boolean =>
  Array.isArray(value["accounts"]) &&
  Array.isArray(value["accountSecrets"]) &&
  value["accountSecrets"].every(isAccountSecretRef) &&
  hasUniqueStrings(value["accountSecrets"].map((secret) => secret.accountId)) &&
  hasValidAccountSecretBindings(
    value["accounts"].filter((account): account is AccountRef | LegacyAccountRef =>
      options.currentAccounts
        ? options.canonical
          ? isAccountRef(account)
          : canonicalAccountRef(account) !== null
        : canonicalLegacyAccountRef(account) !== null,
    ),
    value["accountSecrets"],
  );

/**
 * Validates the legacy schema-v1 vault used only as a migration source. Predates
 * Ledger accounts, so keyless accounts are rejected here.
 */
export const isVaultV1 = (value: unknown): value is VaultV1 =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, [
    "accounts",
    "activeAccountId",
    "originGrants",
    "schemaVersion",
    "signingKeys",
  ]) &&
  value["schemaVersion"] === 1 &&
  hasValidVaultReferences(value, {
    canonical: false,
    currentAccounts: false,
    ledgerAllowed: false,
  });

const V2_V3_KEYS = [
  "accounts",
  "activeAccountId",
  "mnemonic",
  "originGrants",
  "schemaVersion",
  "signingKeys",
] as const;

/**
 * Validates the legacy schema-v2 vault used only as a migration source. Predates
 * Ledger accounts, so its account↔signingKey bijection is strict: a keyless
 * account is rejected at this version.
 */
export const isVaultV2 = (value: unknown): value is VaultV2 =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, V2_V3_KEYS) &&
  value["schemaVersion"] === 2 &&
  isRetainedMnemonic(value["mnemonic"]) &&
  hasValidVaultReferences(value, {
    canonical: false,
    currentAccounts: false,
    ledgerAllowed: false,
  });

/**
 * Validates the current vault schema and internal references, admitting the
 * keyless Ledger account variant.
 */
export const isVaultV3 = (value: unknown): value is VaultV3 =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, V2_V3_KEYS) &&
  value["schemaVersion"] === 3 &&
  isRetainedMnemonic(value["mnemonic"]) &&
  hasValidVaultReferences(value, {
    canonical: false,
    currentAccounts: false,
    ledgerAllowed: true,
  });

const V4_KEYS = [...V2_V3_KEYS, "accountSecrets"] as const;

/**
 * Validates the current vault schema, including the strict separation and
 * account/network bindings for optional encrypted account secrets.
 */
export const isVaultV4 = (value: unknown): value is VaultV4 =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, V4_KEYS) &&
  value["schemaVersion"] === 4 &&
  isRetainedMnemonic(value["mnemonic"]) &&
  hasValidVaultReferences(value, {
    canonical: false,
    currentAccounts: false,
    ledgerAllowed: true,
  }) &&
  hasValidCurrentVaultReferences(value, { canonical: false, currentAccounts: false });

/**
 * Validates the current canonical vault schema and all internal references.
 */
export const isVaultV5 = (value: unknown): value is VaultV5 =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, V4_KEYS) &&
  value["schemaVersion"] === 5 &&
  isRetainedMnemonic(value["mnemonic"]) &&
  hasValidVaultReferences(value, {
    canonical: true,
    currentAccounts: false,
    ledgerAllowed: true,
  }) &&
  hasValidCurrentVaultReferences(value, { canonical: true, currentAccounts: false });

/**
 * Validates the current schema-v6 vault and all internal references.
 */
export const isVaultV6 = (value: unknown): value is VaultV6 =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, V4_KEYS) &&
  value["schemaVersion"] === CURRENT_SCHEMA_VERSION &&
  isRetainedMnemonic(value["mnemonic"]) &&
  hasValidVaultReferences(value, {
    canonical: true,
    currentAccounts: true,
    ledgerAllowed: true,
  }) &&
  hasValidCurrentVaultReferences(value, { canonical: true, currentAccounts: true });
