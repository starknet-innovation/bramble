/**
 * Versioned vault schema and validators for decrypted wallet state.
 */
import { hasOnlyKnownKeys, hasUniqueStrings, isJson, isRecord } from "@bramble/core/json";
import { isWalletOrigin } from "@bramble/core/origin";
import {
  type AccountRef,
  canonicalAccountId,
  canonicalAccountRef,
  canonicalLegacyAccountRef,
  isAccountId,
  isAccountRef,
  isLegacyAccountRef,
  isLegacyV6AccountRef,
  isLegacyV8AccountRef,
  isLegacyV9AccountRef,
  isLegacyV10AccountRef,
  type LegacyAccountRef,
  type LegacyV6AccountRef,
} from "@bramble/wallet-model/accounts";
import { canonicalFelt, isStarkPrivateKey } from "@bramble/wallet-model/networks";
import { isMnemonicText } from "@bramble/wallet-model/passphrase";
import { hasValidAccountSecretBindings, isAccountSecretRef } from "../accounts/account-secrets";
import { hasValidShadowAccountScopes } from "../accounts/shadow-account-scopes";
import { hasValidQsbAccounts, type QsbAccountRecord } from "../qsb/qsb-account";
import { hasValidSeedBindings } from "./schema-seeds";
import type {
  OriginGrant,
  SigningKeyRef,
  VaultV1,
  VaultV2,
  VaultV3,
  VaultV4,
  VaultV5,
  VaultV6,
  VaultV7,
  VaultV8,
  VaultV9,
  VaultV10,
  VaultV11,
  VaultV12,
} from "./schema-types";

/** Re-exports the imported-seed record type from its size-budget split. */
export type { ImportedSeedRef } from "./schema-seeds";
/** Re-exports the legacy type surface from its size-budget split. */
export type {
  OriginGrant,
  SigningKeyRef,
  VaultV1,
  VaultV2,
  VaultV3,
  VaultV4,
  VaultV5,
  VaultV6,
  VaultV7,
  VaultV8,
  VaultV9,
  VaultV10,
  VaultV11,
  VaultV12,
} from "./schema-types";

/**
 * Current vault schema version accepted by validators and writers.
 *
 * Version 13 adds Quantum Safe Bitcoin accounts: a dedicated phrase per account
 * and the id of its disclosure journal, which lives in its own encrypted key.
 * Version 12 keeps an encrypted record of the shadow-account scopes each account
 * used (#443), so stuck shadow-account funds stay recoverable. Version 11 admits
 * accounts derived with Ready's ETH-seeded scheme. Version 10 admits Braavos accounts, and Argent accounts at any release they
 * could have been deployed with rather than only the one this wallet creates;
 * every earlier version stays pinned to that release and holds no Braavos.
 * Version 9 admits Ready's `argentx` Ledger path scheme beside Bramble's
 * `LedgerW`; every earlier version stays pinned to `LedgerW`. Version 8 retains
 * imported seeds, each HD account bound to the phrase that derived it. Version
 * 7 retains the exact Argent deployment salt. Version 6 records
 * account-contract semantics explicitly. Version 5 canonicalized account
 * identities. Version 4 introduced optional account secrets separated from
 * public {@link AccountRef} metadata.
 */
export const CURRENT_SCHEMA_VERSION = 13;

/**
 * Current encrypted vault schema. Version 13 adds the QSB accounts: each one's
 * dedicated phrase, provenance, backup flag, and `journalId` (see
 * `../qsb/qsb-account`). The journal itself is a separate encrypted record
 * with its own budget (`../qsb/qsb-journal-store`). The phrase must never
 * leave this boundary.
 */
export type VaultV13 = Omit<VaultV12, "schemaVersion"> & {
  readonly qsbAccounts: readonly QsbAccountRecord[];
  readonly schemaVersion: 13;
};

/**
 * Alias for the latest supported vault schema.
 */
export type Vault = VaultV13;

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
export const emptyVault = (): VaultV13 => ({
  accounts: [],
  accountSecrets: [],
  activeAccountId: null,
  importedSeeds: [],
  mnemonic: null,
  originGrants: [],
  qsbAccounts: [],
  schemaVersion: CURRENT_SCHEMA_VERSION,
  shadowAccountScopes: [],
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
  accounts: readonly (AccountRef | LegacyAccountRef | LegacyV6AccountRef)[],
  signingKeys: readonly SigningKeyRef[],
): boolean =>
  signingKeys.every((key) => accounts.some((account) => account.id === key.accountId)) &&
  accounts.every(
    (account) =>
      signingKeys.some((key) => key.accountId === account.id) ===
      (account.derivation.kind !== "ledger"),
  );

// Which account validator a vault version's records must satisfy. Every shape
// before "current" holds no Braavos and pins Argent to the release this wallet
// creates; every shape before "v9" also pins Ledger derivations to Bramble's
// `LedgerW` scheme. Those are the only records such vaults could have stored.
type VaultAccountShape = "current" | "v10" | "v9" | "v7v8" | "v6" | "v1v5";

type VaultReferenceOptions = {
  readonly accounts: VaultAccountShape;
  readonly canonical: boolean;
  readonly ledgerAllowed: boolean;
};

const isVaultAccountShape = (
  account: unknown,
  shape: VaultAccountShape,
  canonical: boolean,
): account is AccountRef | LegacyAccountRef | LegacyV6AccountRef => {
  switch (shape) {
    case "current":
      return canonical ? isAccountRef(account) : canonicalAccountRef(account) !== null;
    case "v10":
      return isLegacyV10AccountRef(account);
    case "v9":
      return isLegacyV9AccountRef(account);
    case "v7v8":
      return isLegacyV8AccountRef(account);
    case "v6":
      return isLegacyV6AccountRef(account);
    default:
      return canonical ? isLegacyAccountRef(account) : canonicalLegacyAccountRef(account) !== null;
  }
};

const isVaultAccount = (
  account: unknown,
  options: VaultReferenceOptions,
): account is AccountRef | LegacyAccountRef | LegacyV6AccountRef =>
  isVaultAccountShape(account, options.accounts, options.canonical) &&
  (options.ledgerAllowed || account.derivation.kind !== "ledger");

const hasValidVaultReferences = (
  value: Record<string, unknown>,
  options: VaultReferenceOptions,
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
    accounts.every((account) => isVaultAccount(account, options)) &&
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
  options: Omit<VaultReferenceOptions, "ledgerAllowed">,
): boolean =>
  Array.isArray(value["accounts"]) &&
  Array.isArray(value["accountSecrets"]) &&
  value["accountSecrets"].every(isAccountSecretRef) &&
  hasUniqueStrings(value["accountSecrets"].map((secret) => secret.accountId)) &&
  hasValidAccountSecretBindings(
    value["accounts"].filter(
      (account): account is AccountRef | LegacyAccountRef | LegacyV6AccountRef =>
        isVaultAccountShape(account, options.accounts, options.canonical),
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
  hasValidVaultReferences(value, { accounts: "v1v5", canonical: false, ledgerAllowed: false });

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
  hasValidVaultReferences(value, { accounts: "v1v5", canonical: false, ledgerAllowed: false });

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
  hasValidVaultReferences(value, { accounts: "v1v5", canonical: false, ledgerAllowed: true });

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
  hasValidVaultReferences(value, { accounts: "v1v5", canonical: false, ledgerAllowed: true }) &&
  hasValidCurrentVaultReferences(value, { accounts: "v1v5", canonical: false });

/**
 * Validates the current canonical vault schema and all internal references.
 */
export const isVaultV5 = (value: unknown): value is VaultV5 =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, V4_KEYS) &&
  value["schemaVersion"] === 5 &&
  isRetainedMnemonic(value["mnemonic"]) &&
  hasValidVaultReferences(value, { accounts: "v1v5", canonical: true, ledgerAllowed: true }) &&
  hasValidCurrentVaultReferences(value, { accounts: "v1v5", canonical: true });

/**
 * Validates legacy schema-v6 vaults for the adjacent v7 migration.
 */
export const isVaultV6 = (value: unknown): value is VaultV6 =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, V4_KEYS) &&
  value["schemaVersion"] === 6 &&
  isRetainedMnemonic(value["mnemonic"]) &&
  hasValidVaultReferences(value, { accounts: "v6", canonical: true, ledgerAllowed: true }) &&
  hasValidCurrentVaultReferences(value, { accounts: "v6", canonical: true });

/**
 * Validates legacy schema-v7 vaults for the adjacent v8 migration. Ledger
 * derivations are pinned to Bramble's `LedgerW` scheme.
 */
export const isVaultV7 = (value: unknown): value is VaultV7 =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, V4_KEYS) &&
  value["schemaVersion"] === 7 &&
  isRetainedMnemonic(value["mnemonic"]) &&
  hasValidVaultReferences(value, { accounts: "v7v8", canonical: true, ledgerAllowed: true }) &&
  hasValidCurrentVaultReferences(value, { accounts: "v7v8", canonical: true });

const V8_KEYS = [...V4_KEYS, "importedSeeds"] as const;

/**
 * Validates legacy schema-v8 vaults for the adjacent v9 migration. Ledger
 * derivations are pinned to Bramble's `LedgerW` scheme; a v8 record naming
 * Ready's `argentx` scheme is refused, as no v8 writer ever produced one.
 */
export const isVaultV8 = (value: unknown): value is VaultV8 =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, V8_KEYS) &&
  value["schemaVersion"] === 8 &&
  isRetainedMnemonic(value["mnemonic"]) &&
  hasValidVaultReferences(value, { accounts: "v7v8", canonical: true, ledgerAllowed: true }) &&
  hasValidCurrentVaultReferences(value, { accounts: "v7v8", canonical: true }) &&
  hasValidSeedBindings(value);

/**
 * Validates legacy schema-v9 vaults for the adjacent v10 migration. Records hold
 * no Braavos account and Argent only at the release this wallet creates, as no
 * v9 writer ever produced anything else.
 */
export const isVaultV9 = (value: unknown): value is VaultV9 =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, V8_KEYS) &&
  value["schemaVersion"] === 9 &&
  isRetainedMnemonic(value["mnemonic"]) &&
  hasValidVaultReferences(value, { accounts: "v9", canonical: true, ledgerAllowed: true }) &&
  hasValidCurrentVaultReferences(value, { accounts: "v9", canonical: true }) &&
  hasValidSeedBindings(value);

/**
 * Validates canonical schema-v10 vaults for their one-step migration: the
 * current shape, but no Ready-scheme (`argentx-bip44`) account record. Legacy
 * vault validators only.
 */
export const isVaultV10 = (value: unknown): value is VaultV10 =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, V8_KEYS) &&
  value["schemaVersion"] === 10 &&
  isRetainedMnemonic(value["mnemonic"]) &&
  hasValidVaultReferences(value, { accounts: "v10", canonical: true, ledgerAllowed: true }) &&
  hasValidCurrentVaultReferences(value, { accounts: "v10", canonical: true }) &&
  hasValidSeedBindings(value);

/**
 * Validates schema-v11 vaults and all internal references, admitting accounts
 * derived with Ready's ETH-seeded scheme alongside everything v10 held. Also
 * the body of the v12 validator, which adds only the scope records.
 */
export const isVaultV11 = (value: unknown): value is VaultV11 =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, V8_KEYS) &&
  value["schemaVersion"] === 11 &&
  isRetainedMnemonic(value["mnemonic"]) &&
  hasValidVaultReferences(value, { accounts: "current", canonical: true, ledgerAllowed: true }) &&
  hasValidCurrentVaultReferences(value, { accounts: "current", canonical: true }) &&
  hasValidSeedBindings(value);

const V12_KEYS = [...V8_KEYS, "shadowAccountScopes"] as const;

/**
 * Validates schema-v12 vaults for the adjacent v13 migration, and is the body
 * of the v13 validator: everything v11 holds, plus shadow-account scope
 * records that are well formed, canonical, distinct, and bound to a retained
 * account on its own chain.
 */
export const isVaultV12 = (value: unknown): value is VaultV12 => {
  if (!isRecord(value) || !hasOnlyKnownKeys(value, V12_KEYS) || value["schemaVersion"] !== 12) {
    return false;
  }
  const { shadowAccountScopes, ...rest } = value;
  return (
    isVaultV11({ ...rest, schemaVersion: 11 }) &&
    hasValidShadowAccountScopes(rest["accounts"] as VaultV11["accounts"], shadowAccountScopes)
  );
};

const V13_KEYS = [...V12_KEYS, "qsbAccounts"] as const;

// Every Starknet phrase the vault retains: a QSB phrase must be none of them.
const starknetPhrases = (value: Record<string, unknown>): readonly string[] => [
  ...(typeof value["mnemonic"] === "string" ? [value["mnemonic"]] : []),
  ...(Array.isArray(value["importedSeeds"])
    ? value["importedSeeds"].flatMap((seed: unknown) =>
        isRecord(seed) && typeof seed["mnemonic"] === "string" ? [seed["mnemonic"]] : [],
      )
    : []),
];

/**
 * Validates the current schema-v13 vault: everything v12 holds, plus QSB
 * accounts that are each valid, within the account bound, distinct, and hold a
 * dedicated phrase. The whole value, QSB records included, must also fit the
 * provider JSON budget — the capacity the write path enforces — so a vault
 * this accepts on read is one the wallet could have written.
 */
export const isVaultV13 = (value: unknown): value is VaultV13 => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, V13_KEYS) ||
    value["schemaVersion"] !== CURRENT_SCHEMA_VERSION
  ) {
    return false;
  }
  const { qsbAccounts, ...rest } = value;
  return (
    isVaultV12({ ...rest, schemaVersion: 12 }) &&
    isJson(value) &&
    hasValidQsbAccounts(qsbAccounts, starknetPhrases(rest))
  );
};
