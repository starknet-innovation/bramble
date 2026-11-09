/**
 * The preferences backup file (Sherlock 213).
 *
 * A restore reapplies only the organisational fields (`pickImportablePreferences`):
 * every trust-bearing setting, the address book included, keeps its stored
 * value, because a backup file is untrusted input. The file therefore carries
 * only those fields. Writing the rest would hand the contact graph, custom
 * endpoints and hidden accounts to whoever holds the file while promising a
 * restore that never brings them back.
 */
import type { WalletPreferences } from "./preferences";
import { defaultWalletPreferences } from "./preferences";
import { pickImportablePreferences } from "./preferences-stored";

/**
 * Builds the backup record to write to a file: the stored preferences' importable
 * fields over the defaults. Every other field holds its default, so the record
 * still validates as a full preferences backup and older builds can restore it,
 * yet no contact, endpoint, token list or hidden-account id leaves the wallet.
 * Never includes secret material; preferences hold none.
 */
export const exportablePreferences = (preferences: WalletPreferences): WalletPreferences => ({
  ...defaultWalletPreferences(),
  ...pickImportablePreferences(preferences),
});
