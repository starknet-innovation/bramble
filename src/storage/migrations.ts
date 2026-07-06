/**
 * Pure vault migrations. Every branch must be deterministic and tested.
 */
import { WalletError } from "../shared/errors";
import { isRecord } from "../shared/json";
import { CURRENT_SCHEMA_VERSION, emptyVault, isVaultV1, type Vault } from "./vault-schema";

/**
 * Current schema version re-exported for migration tests and callers.
 */
export { CURRENT_SCHEMA_VERSION } from "./vault-schema";

const isLegacyEmptyVault = (value: unknown): boolean =>
  isRecord(value) && !("schemaVersion" in value) && Reflect.ownKeys(value).length === 0;

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
        return emptyVault();
      }
      throw new WalletError("Unsupported vault schema");
    },
    toVersion: 1,
  },
];

const schemaVersionOf = (value: unknown): number | null => {
  if (value === null || value === undefined || isLegacyEmptyVault(value)) {
    return 0;
  }

  if (isRecord(value) && Number.isSafeInteger(value.schemaVersion)) {
    return Number(value.schemaVersion);
  }

  return null;
};

const migrationFrom = (version: number): VaultMigrationStep | undefined =>
  VAULT_MIGRATIONS.find((migration) => migration.fromVersion === version);

/**
 * Migrates unknown decrypted vault data to the current schema or fails closed.
 */
export const migrateVault = (value: unknown): Vault => {
  if (isVaultV1(value)) {
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

  if (!isVaultV1(migrated)) {
    throw new WalletError("Unsupported vault schema");
  }

  return migrated;
};
