/**
 * Pure vault migrations. Every branch must be deterministic and tested.
 */
import { WalletError } from "@bramble/core/errors";
import { isRecord } from "@bramble/core/json";
import {
  canonicalAccountId,
  canonicalLegacyAccountRef,
  type LegacyAccountRef,
} from "@bramble/wallet-model/accounts";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import {
  CURRENT_SCHEMA_VERSION,
  isVaultV1,
  isVaultV2,
  isVaultV3,
  isVaultV4,
  isVaultV5,
  isVaultV6,
  isVaultV7,
  type Vault,
  type VaultV4,
  type VaultV5,
  type VaultV6,
} from "./schema";

/**
 * Current schema version re-exported for migration tests and callers.
 */
export { CURRENT_SCHEMA_VERSION } from "./schema";

const isLegacyEmptyVault = (value: unknown): boolean =>
  isRecord(value) && Reflect.ownKeys(value).length === 0;

/**
 * Deterministic schema migration from one numbered vault version to the next.
 */
export type VaultMigrationStep = {
  readonly fromVersion: number;
  readonly migrate: (value: unknown) => unknown;
  readonly toVersion: number;
};

/**
 * Ordered vault migration plan. Add one adjacent step per schema version.
 */
export const VAULT_MIGRATIONS: readonly VaultMigrationStep[] = [
  {
    fromVersion: 0,
    migrate(value) {
      if (value === null || value === undefined || isLegacyEmptyVault(value)) {
        return {
          accounts: [],
          activeAccountId: null,
          originGrants: [],
          schemaVersion: 1,
          signingKeys: [],
        };
      }
      throw new WalletError("Unsupported vault schema");
    },
    toVersion: 1,
  },
  {
    fromVersion: 1,
    migrate(value) {
      if (!isVaultV1(value)) {
        throw new WalletError("Unsupported vault schema");
      }
      return { ...value, mnemonic: null, schemaVersion: 2 };
    },
    toVersion: 2,
  },
  {
    fromVersion: 2,
    // The Ledger account variant is additive: a stored v2 vault cannot contain a
    // keyless account, so this rewrites nothing but the version stamp. It stays
    // deterministic and validates the source shape before bumping.
    migrate(value) {
      if (!isVaultV2(value)) {
        throw new WalletError("Unsupported vault schema");
      }
      return { ...value, schemaVersion: 3 };
    },
    toVersion: 3,
  },
  {
    fromVersion: 3,
    // Optional account secrets are new in v4. Existing accounts have none, so
    // the only valid deterministic migration is an empty encrypted collection.
    migrate(value) {
      if (!isVaultV3(value)) {
        throw new WalletError("Unsupported vault schema");
      }
      return { ...value, accountSecrets: [], schemaVersion: 4 };
    },
    toVersion: 4,
  },
  {
    fromVersion: 4,
    // Account ids used to admit leading-zero aliases. Rebuild every identity
    // and dependent reference through the shared canonicalizer. Ambiguous
    // alias collisions remain duplicated and are rejected by the v5 validator
    // rather than silently choosing which account survives.
    migrate(value) {
      if (!isVaultV4(value)) {
        throw new WalletError("Unsupported vault schema");
      }
      return canonicalVault(value);
    },
    toVersion: 5,
  },
  {
    fromVersion: 5,
    // Every historical account was derived, deployed, and signed with
    // OpenZeppelin account semantics. Preserve every identity and dependent
    // reference while making that previously implicit invariant explicit.
    migrate(value) {
      if (!isVaultV5(value)) {
        throw new WalletError("Unsupported vault schema");
      }
      return withAccountContractTypes(value);
    },
    toVersion: 6,
  },
  {
    fromVersion: 6,
    // MC Wallet's first Argent account release derived every address with the
    // public key as its salt. Retain that exact historical convention while
    // allowing later imports to carry an explicit upstream deployment salt.
    migrate(value) {
      if (!isVaultV6(value)) {
        throw new WalletError("Unsupported vault schema");
      }
      return withArgentDeploymentSalts(value);
    },
    toVersion: 7,
  },
];

const requiredAccountId = (value: string): string => {
  const canonical = canonicalAccountId(value);
  if (canonical === null) {
    throw new WalletError("Unsupported vault schema");
  }
  return canonical;
};

const requiredAccount = (value: LegacyAccountRef): LegacyAccountRef => {
  const canonical = canonicalLegacyAccountRef(value);
  if (canonical === null) {
    throw new WalletError("Unsupported vault schema");
  }
  return canonical;
};

const withAccountContractTypes = (value: VaultV5): unknown => ({
  ...value,
  accounts: value.accounts.map((account) => ({
    accountContractType: "openzeppelin" as const,
    ...account,
  })),
  schemaVersion: 6,
});

const withArgentDeploymentSalts = (value: VaultV6): unknown => ({
  ...value,
  accounts: value.accounts.map((account) =>
    account.accountContractType === "argent"
      ? { ...account, deploymentSalt: account.publicKeyX }
      : account,
  ),
  schemaVersion: 7,
});

const canonicalVault = (value: VaultV4): unknown => ({
  ...value,
  accounts: value.accounts.map(requiredAccount),
  accountSecrets: value.accountSecrets.map((secret) => ({
    ...secret,
    accountId: requiredAccountId(secret.accountId),
  })),
  activeAccountId: value.activeAccountId === null ? null : requiredAccountId(value.activeAccountId),
  originGrants: value.originGrants.map((grant) => ({
    ...grant,
    accountIds: [...new Set(grant.accountIds.map(requiredAccountId))],
  })),
  schemaVersion: 5,
  signingKeys: value.signingKeys.map((signingKey) => ({
    accountId: requiredAccountId(signingKey.accountId),
    privateKey: canonicalFelt(signingKey.privateKey) ?? signingKey.privateKey,
  })),
});

const schemaVersionOf = (value: unknown): number | null => {
  if (value === null || value === undefined || isLegacyEmptyVault(value)) {
    return 0;
  }

  if (isRecord(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, "schemaVersion");
    if (
      descriptor?.enumerable === true &&
      "value" in descriptor &&
      Number.isSafeInteger(descriptor.value) &&
      Number(descriptor.value) >= 0
    ) {
      return Number(descriptor.value);
    }
  }

  return null;
};

const migrationFrom = (version: number): VaultMigrationStep | undefined =>
  VAULT_MIGRATIONS.find((migration) => migration.fromVersion === version);

/**
 * Migrates unknown decrypted vault data to the current schema or fails closed.
 */
export const migrateVault = (value: unknown): Vault => {
  if (isVaultV7(value)) {
    return value;
  }

  const startVersion = schemaVersionOf(value);
  if (startVersion === null || startVersion > CURRENT_SCHEMA_VERSION) {
    throw new WalletError("Unsupported vault schema");
  }

  let migrated: unknown = value;
  for (let version = startVersion; version < CURRENT_SCHEMA_VERSION; version += 1) {
    const migration = migrationFrom(version);
    if (!migration || migration.toVersion !== version + 1) {
      throw new WalletError("Unsupported vault schema");
    }
    migrated = migration.migrate(migrated);
  }

  if (!isVaultV7(migrated)) {
    throw new WalletError("Unsupported vault schema");
  }

  return migrated;
};
