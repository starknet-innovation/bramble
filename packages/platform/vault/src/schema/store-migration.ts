/**
 * Crash-recoverable encrypted-vault schema migration orchestration. Pure schema
 * steps live in `migrations.ts`; this module owns the storage side effects that
 * can only run after unlock supplies the vault passphrase.
 */
import { WalletError } from "@mc-wallet/core/errors";
import type { EncryptedStore } from "../encrypted-store";
import { migrateVault } from "./migrations";
import { isVaultV7, type Vault } from "./schema";

/**
 * Browser storage key for the primary encrypted wallet vault.
 */
export const VAULT_STORE_KEY = "mc-wallet:vault";

/**
 * Temporary encrypted staging key used only while committing a vault update.
 */
export const VAULT_MIGRATION_STORE_KEY = "mc-wallet:vault-migration";

/**
 * Primary and staging encrypted stores participating in one vault migration.
 */
export type VaultMigrationStores = {
  readonly primary: EncryptedStore;
  readonly staging: EncryptedStore;
};

const sameVault = (left: Vault, right: Vault): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const readVerified = async (
  store: EncryptedStore,
  vaultPassphrase: string,
  expected: Vault,
): Promise<Vault> => {
  const candidate = await store.read(vaultPassphrase);
  if (!isVaultV7(candidate) || !sameVault(candidate, expected)) {
    throw new WalletError("Vault migration verification failed");
  }
  return candidate;
};

const removeVerified = async (store: EncryptedStore): Promise<void> => {
  await store.remove();
  if (await store.exists()) {
    throw new WalletError("Vault migration cleanup failed");
  }
};

const recoverStagedVault = async (
  stores: VaultMigrationStores,
  vaultPassphrase: string,
): Promise<Vault | null> => {
  if (!(await stores.staging.exists())) {
    return null;
  }
  const staged = await stores.staging.read(vaultPassphrase);
  if (!isVaultV7(staged)) {
    return null;
  }
  await stores.primary.write(staged, vaultPassphrase);
  await readVerified(stores.primary, vaultPassphrase, staged);
  await removeVerified(stores.staging);
  return staged;
};

/**
 * Reads and durably upgrades an encrypted vault after unlock. Schema output is
 * first written and verified under an authenticated staging scope, then written
 * and verified at the primary scope. A worker termination before commit leaves
 * the old primary intact; one after commit leaves a valid staged recovery copy.
 * Invalid source or migration output is rejected before the primary write.
 */
export const readMigratedVault = async (
  stores: VaultMigrationStores,
  vaultPassphrase: string,
): Promise<Vault> => {
  let stored: unknown;
  try {
    stored = await stores.primary.read(vaultPassphrase);
  } catch (primaryError) {
    try {
      const recovered = await recoverStagedVault(stores, vaultPassphrase);
      if (recovered) {
        return recovered;
      }
    } catch {
      // Preserve the primary failure so a wrong passphrase or corrupted primary
      // cannot be confused with a recoverable interrupted migration.
    }
    throw primaryError;
  }

  const vault = migrateVault(stored);
  if (stored === undefined) {
    return vault;
  }
  if (isVaultV7(stored)) {
    if (await stores.staging.exists()) {
      await removeVerified(stores.staging);
    }
    return vault;
  }

  await stores.staging.write(vault, vaultPassphrase);
  await readVerified(stores.staging, vaultPassphrase, vault);
  await stores.primary.write(vault, vaultPassphrase);
  await readVerified(stores.primary, vaultPassphrase, vault);
  await removeVerified(stores.staging);
  return vault;
};
