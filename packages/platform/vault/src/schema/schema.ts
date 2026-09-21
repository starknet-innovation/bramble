/**
 * Versioned vault schema and validators for decrypted wallet state.
 */
import { hasOnlyKnownKeys, hasUniqueStrings, isJson, isRecord } from "@bramble/core/json";
import { isWalletOrigin } from "@bramble/core/origin";
import {
  type AccountRef,
  ARGENT_ACCOUNT_CLASS_HASH,
  canonicalAccountId,
  canonicalAccountRef,
  canonicalLegacyAccountRef,
  isAccountId,
  isAccountRef,
  isImportedSeedId,
  isLegacyAccountRef,
  isLegacyV6AccountRef,
  isLegacyV8AccountRef,
  type LegacyAccountRef,
  type LegacyV6AccountRef,
} from "@bramble/wallet-model/accounts";
import { canonicalFelt, isStarkPrivateKey, sameFelt } from "@bramble/wallet-model/networks";
import { isMnemonicText } from "@bramble/wallet-model/passphrase";
import type { OriginGrant, SigningKeyRef, VaultV1, VaultV2, VaultV3 } from "./schema-types";

/** Re-exports the legacy type surface from its size-budget split. */
export type { OriginGrant, SigningKeyRef, VaultV1, VaultV2, VaultV3 } from "./schema-types";

import {
  type AccountSecretRef,
  hasValidAccountSecretBindings,
  isAccountSecretRef,
} from "../accounts/account-secrets";

/**
 * Current vault schema version accepted by validators and writers.
 *
 * Version 9 admits Ready's `argentx` Ledger path scheme beside Bramble's
 * `LedgerW`; every earlier version stays pinned to `LedgerW`. Version 8 retains
 * imported seeds, each HD account bound to the phrase that derived it. Version
 * 7 retains the exact Argent deployment salt. Version 6 records
 * account-contract semantics explicitly. Version 5 canonicalized account
 * identities. Version 4 introduced optional account secrets separated from
 * public {@link AccountRef} metadata.
 */
export const CURRENT_SCHEMA_VERSION = 9;

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
  readonly accounts: readonly LegacyV6AccountRef[];
  readonly schemaVersion: 6;
};

/**
 * Current encrypted vault schema. Argent accounts retain the exact deployment
 * salt so externally created accounts remain deployable at their real address.
 */
export type VaultV7 = Omit<VaultV4, "accounts" | "schemaVersion"> & {
  readonly accounts: readonly AccountRef[];
  readonly schemaVersion: 7;
};

/**
 * One imported recovery phrase retained beside the founding phrase, inside the
 * encrypted vault only; `id` is the handle HD derivations reference.
 */
export type ImportedSeedRef = {
  readonly id: string;
  readonly mnemonic: string;
};

/**
 * Legacy encrypted vault schema. Version 8 retains imported seeds so accounts
 * recovered from another wallet's phrase stay re-derivable and revealable; its
 * Ledger derivations may only follow Bramble's `LedgerW` scheme.
 */
export type VaultV8 = Omit<VaultV7, "schemaVersion"> & {
  readonly importedSeeds: readonly ImportedSeedRef[];
  readonly schemaVersion: 8;
};

/**
 * Current encrypted vault schema. Version 9 admits a Ledger derivation under
 * Ready's `argentx` path scheme (an account restored from Ready) beside
 * Bramble's `LedgerW`; the record shape is unchanged.
 */
export type VaultV9 = Omit<VaultV8, "schemaVersion"> & { readonly schemaVersion: 9 };

/**
 * Alias for the latest supported vault schema.
 */
export type Vault = VaultV9;

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
export const emptyVault = (): VaultV9 => ({
  accounts: [],
  accountSecrets: [],
  activeAccountId: null,
  importedSeeds: [],
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
// before "current" pins Ledger derivations to Bramble's `LedgerW` scheme, the
// only one those vaults could ever have stored.
type VaultAccountShape = "current" | "v7v8" | "v6" | "v1v5";

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

const hasValidAccountContractBindings = (value: Record<string, unknown>): boolean =>
  Array.isArray(value["accounts"]) &&
  value["accounts"].every(
    (account) =>
      isAccountRef(account) &&
      (account.accountContractType !== "argent" ||
        sameFelt(account.classHash, ARGENT_ACCOUNT_CLASS_HASH)),
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
  hasValidAccountContractBindings(value) &&
  hasValidCurrentVaultReferences(value, { accounts: "v7v8", canonical: true });

const V8_KEYS = [...V4_KEYS, "importedSeeds"] as const;

const isImportedSeedRef = (value: unknown): value is ImportedSeedRef =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["id", "mnemonic"]) &&
  isImportedSeedId(value["id"]) &&
  isMnemonicText(value["mnemonic"]);

// Every HD account naming a seedId must reference a retained imported seed, so
// a reveal or re-derivation can never dangle (founding-phrase accounts carry
// none — see the VaultV3 mutation-boundary phrase rules).
const hasValidSeedBindings = (value: Record<string, unknown>): boolean => {
  const seeds = value["importedSeeds"];
  if (!Array.isArray(seeds) || !seeds.every(isImportedSeedRef)) {
    return false;
  }
  if (!hasUniqueStrings(seeds.map((seed) => seed.id))) {
    return false;
  }
  const accounts = value["accounts"];
  return (
    Array.isArray(accounts) &&
    accounts.every((account) => {
      const seedId =
        isAccountRef(account) && account.derivation.kind === "starknet-bip44"
          ? account.derivation.seedId
          : undefined;
      return seedId === undefined || seeds.some((seed) => seed.id === seedId);
    })
  );
};

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
  hasValidAccountContractBindings(value) &&
  hasValidCurrentVaultReferences(value, { accounts: "v7v8", canonical: true }) &&
  hasValidSeedBindings(value);

/**
 * Validates the current schema-v9 vault and all internal references, admitting
 * Ledger derivations under either supported path scheme.
 */
export const isVaultV9 = (value: unknown): value is VaultV9 =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, V8_KEYS) &&
  value["schemaVersion"] === CURRENT_SCHEMA_VERSION &&
  isRetainedMnemonic(value["mnemonic"]) &&
  hasValidVaultReferences(value, { accounts: "current", canonical: true, ledgerAllowed: true }) &&
  hasValidAccountContractBindings(value) &&
  hasValidCurrentVaultReferences(value, { accounts: "current", canonical: true }) &&
  hasValidSeedBindings(value);
