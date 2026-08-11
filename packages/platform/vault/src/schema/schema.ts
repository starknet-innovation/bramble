/**
 * Versioned vault schema and validators for decrypted wallet state.
 */
import { hasOnlyKnownKeys, hasUniqueStrings, isJson, isRecord } from "@mc-wallet/core/json";
import { isWalletOrigin } from "@mc-wallet/core/origin";
import {
  type AccountRef,
  isAccountId,
  isAccountRef,
  isKeylessAccount,
} from "@mc-wallet/wallet-model/accounts";
import { isNonZeroStarkFieldElement } from "@mc-wallet/wallet-model/networks";
import {
  type AccountSecretRef,
  hasValidAccountSecretBindings,
  isAccountSecretRef,
} from "../accounts/account-secrets";

/**
 * Current vault schema version accepted by validators and writers.
 *
 * Version 4 separates optional account secrets from public {@link AccountRef}
 * metadata. Existing v3 vaults migrate by adding an empty collection; later
 * background-only mutations may retain a scope-bound Ledger STRK20 viewing key
 * there without making it projectable to UI or provider callers.
 */
export const CURRENT_SCHEMA_VERSION = 4;

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
  readonly accounts: readonly AccountRef[];
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
  readonly accounts: readonly AccountRef[];
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
  readonly accounts: readonly AccountRef[];
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
  readonly accounts: readonly AccountRef[];
  readonly accountSecrets: readonly AccountSecretRef[];
  readonly activeAccountId: string | null;
  readonly mnemonic: string | null;
  readonly originGrants: readonly OriginGrant[];
  readonly schemaVersion: 4;
  readonly signingKeys: readonly SigningKeyRef[];
};

/**
 * Alias for the latest supported vault schema.
 */
export type Vault = VaultV4;

const isSigningKeyRef = (value: unknown): value is SigningKeyRef =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountId", "privateKey"]) &&
  isAccountId(value["accountId"]) &&
  typeof value["privateKey"] === "string" &&
  isNonZeroStarkFieldElement(value["privateKey"]);

const isOriginGrant = (value: unknown): value is OriginGrant =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountIds", "origin"]) &&
  Array.isArray(value["accountIds"]) &&
  value["accountIds"].length > 0 &&
  value["accountIds"].every(isAccountId) &&
  typeof value["origin"] === "string" &&
  isWalletOrigin(value["origin"]);

/**
 * Creates a deterministic empty current vault.
 */
export const emptyVault = (): VaultV4 => ({
  accounts: [],
  accountSecrets: [],
  activeAccountId: null,
  mnemonic: null,
  originGrants: [],
  schemaVersion: CURRENT_SCHEMA_VERSION,
  signingKeys: [],
});

const isRetainedMnemonic = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && value.trim().length > 0);

// Relaxed account↔signingKey bijection: every signing key must map to an
// account, and every account must hold exactly one signing key UNLESS it is a
// keyless Ledger account, which must hold none. For key-backed-only vaults
// (v1/v2, where a Ledger account cannot appear) this is identical to a strict
// bijection. Extracted so the main validator stays within the complexity budget.
const hasValidKeyBindings = (
  accounts: readonly AccountRef[],
  signingKeys: readonly SigningKeyRef[],
): boolean =>
  signingKeys.every((key) => accounts.some((account) => account.id === key.accountId)) &&
  accounts.every(
    (account) =>
      signingKeys.some((key) => key.accountId === account.id) === !isKeylessAccount(account),
  );

const hasValidVaultReferences = (
  value: Record<string, unknown>,
  options: { readonly ledgerAllowed: boolean },
): boolean => {
  if (
    (!isAccountId(value["activeAccountId"]) && value["activeAccountId"] !== null) ||
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
        isAccountRef(account) && (options.ledgerAllowed || account.derivation.kind !== "ledger"),
    ) &&
    hasUniqueStrings(accounts.map((account) => account.id)) &&
    originGrants.every(isOriginGrant) &&
    hasUniqueStrings(originGrants.map((grant) => grant.origin)) &&
    originGrants.every((grant) => hasUniqueStrings(grant.accountIds)) &&
    originGrants.every((grant) =>
      grant.accountIds.every((accountId) => accounts.some((account) => account.id === accountId)),
    ) &&
    signingKeys.every(isSigningKeyRef) &&
    hasUniqueStrings(signingKeys.map((key) => key.accountId)) &&
    hasValidKeyBindings(accounts, signingKeys) &&
    (accounts.length === 0
      ? value["activeAccountId"] === null
      : value["activeAccountId"] !== null &&
        accounts.some((account) => account.id === value["activeAccountId"]))
  );
};

const hasValidCurrentVaultReferences = (value: Record<string, unknown>): boolean =>
  Array.isArray(value["accounts"]) &&
  Array.isArray(value["accountSecrets"]) &&
  value["accountSecrets"].every(isAccountSecretRef) &&
  hasUniqueStrings(value["accountSecrets"].map((secret) => secret.accountId)) &&
  hasValidAccountSecretBindings(value["accounts"].filter(isAccountRef), value["accountSecrets"]);

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
  hasValidVaultReferences(value, { ledgerAllowed: false });

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
  hasValidVaultReferences(value, { ledgerAllowed: false });

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
  hasValidVaultReferences(value, { ledgerAllowed: true });

const V4_KEYS = [...V2_V3_KEYS, "accountSecrets"] as const;

/**
 * Validates the current vault schema, including the strict separation and
 * account/network bindings for optional encrypted account secrets.
 */
export const isVaultV4 = (value: unknown): value is VaultV4 =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, V4_KEYS) &&
  value["schemaVersion"] === CURRENT_SCHEMA_VERSION &&
  isRetainedMnemonic(value["mnemonic"]) &&
  hasValidVaultReferences(value, { ledgerAllowed: true }) &&
  hasValidCurrentVaultReferences(value);
