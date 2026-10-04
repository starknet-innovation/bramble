/**
 * Vault reinitialize: copy the encrypted vault to an archive key, then clear
 * the live copies so the next start is first-run. The archive is written and
 * verified before anything is removed, so an interrupted reset leaves the
 * primary vault intact. This route exists for a user who cannot open the vault;
 * the archived blob stays encrypted and is recoverable offline.
 */
import type { KeyValueStore } from "@bramble/store/kv";
import type { EncryptedStore } from "../encrypted-store";
import { VAULT_ARCHIVE_STORE_KEY } from "../schema/store-migration";
import type { ResetVaultResult } from "./service-types";

/**
 * Archives the primary encrypted vault and clears the live stores.
 *
 * The primary copy is verified in the archive before it is removed, so a failed
 * archive leaves the wallet untouched. A leftover migration staging copy is
 * inert and self-healing on the next vault read, so its removal is
 * best-effort and never fails an otherwise complete reset.
 */
export const resetVaultStorage = async (
  stores: { readonly primary: EncryptedStore; readonly staging: EncryptedStore },
  archiveStore: KeyValueStore,
): Promise<ResetVaultResult> => {
  const archived = await stores.primary.archiveTo(archiveStore, VAULT_ARCHIVE_STORE_KEY);
  await stores.staging.remove().catch(() => undefined);
  return { archived };
};
