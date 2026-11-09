/**
 * Settings-screen bindings as one unit.
 *
 * All seven share a single dependency object — the same account scope, the same
 * refresh, and the two pieces of editor state a repaint has to preserve — so they
 * are bound together rather than re-listed at the entry point.
 */

import { bindFindAccounts } from "./find-accounts-ui";
import { bindImportKey } from "./import-key-ui";
import { bindImportPhrase } from "./import-phrase-ui";
import { bindPrivacyUnlock } from "./privacy-unlock";
import {
  bindAccountLabel,
  bindAccountVisibility,
  bindAddAccount,
  bindAppearance,
  bindBackup,
  bindContacts,
  bindGroups,
  type SettingsUiDeps,
} from "./settings-ui";

/**
 * What every settings binding needs from the entry point — the same contract the
 * individual bindings declare, re-exported so the entry point names it once.
 * `setExpandedGroup` and `setOpenAssign` exist because a full-shell repaint would
 * otherwise close the editor the user is typing in.
 */
export type SettingsSurfaceDeps = SettingsUiDeps;

/**
 * Binds every settings control against one shared dependency object.
 */
export const bindSettingsSurface = (deps: SettingsSurfaceDeps): void => {
  bindAccountLabel(deps);
  bindAccountVisibility(deps);
  bindAddAccount(deps);
  bindImportKey(deps);
  bindImportPhrase(deps);
  bindFindAccounts(deps);
  bindAppearance(deps);
  bindPrivacyUnlock(deps);
  bindBackup(deps);
  bindContacts(deps);
  bindGroups(deps);
};
