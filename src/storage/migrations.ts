/**
 * Pure vault migrations. Every branch must be deterministic and tested.
 */
import { WalletError } from "../shared/errors";
import { isRecord } from "../shared/json";
import {
  CURRENT_SCHEMA_VERSION,
  isVaultV1,
  isVaultV2,
  isVaultV3,
  type Vault,
} from "./vault-schema";

/**
 * Current schema version re-exported for migration tests and callers.
 */
export { CURRENT_SCHEMA_VERSION } from "./vault-schema";

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
];

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
  if (isVaultV3(value)) {
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

  if (!isVaultV3(migrated)) {
    throw new WalletError("Unsupported vault schema");
  }

  return migrated;
};
