/**
 * Atomic account-group ("folder") mutations over a preferences record. Each
 * returns the next record; persisting it is the store's job.
 *
 * Every write starts from a seeded list. Both default folders are structural
 * rather than user-made, so a wallet that has never stored a group must still
 * accept an account being filed into "My accounts" or "Archived accounts" — the
 * pure setters no-op on an id they cannot find, which would otherwise make a
 * drag onto a default folder silently do nothing.
 */
import {
  type AccountGroupIcon,
  type AccountGroups,
  createGroup,
  removeGroup,
  renameGroup,
  setAccountInGroup,
  setGroupIcon,
  withDefaultGroups,
} from "./groups";
import type { WalletPreferences } from "./preferences-types";

const seeded = (preferences: WalletPreferences): AccountGroups =>
  withDefaultGroups(preferences.groups ?? []);

// Both ends of a write are seeded: the result too, so a newly created group is
// stored in display order (between the home folder and the archive) rather than
// appended after the archive and only reordered on the next read.
const withGroups = (preferences: WalletPreferences, groups: AccountGroups): WalletPreferences => ({
  ...preferences,
  groups: withDefaultGroups(groups),
});

/** Appends a group with a deterministic, collision-free id. */
export const withCreatedGroup = (
  preferences: WalletPreferences,
  name: string,
  icon: AccountGroupIcon,
): WalletPreferences => withGroups(preferences, createGroup(seeded(preferences), name, icon));

/** Renames one group; a no-op for an unknown id. */
export const withRenamedGroup = (
  preferences: WalletPreferences,
  id: string,
  name: string,
): WalletPreferences => withGroups(preferences, renameGroup(seeded(preferences), id, name));

/** Re-icons one group; a no-op for an unknown id. */
export const withGroupIcon = (
  preferences: WalletPreferences,
  id: string,
  icon: AccountGroupIcon,
): WalletPreferences => withGroups(preferences, setGroupIcon(seeded(preferences), id, icon));

/** Deletes one group; a no-op for an unknown id or either default folder. */
export const withoutGroup = (preferences: WalletPreferences, id: string): WalletPreferences =>
  withGroups(preferences, removeGroup(seeded(preferences), id));

/** Files an account into, or out of, one group under the single-folder model. */
export const withAccountInGroup = (
  preferences: WalletPreferences,
  input: { readonly accountId: string; readonly groupId: string; readonly member: boolean },
): WalletPreferences =>
  withGroups(
    preferences,
    setAccountInGroup(seeded(preferences), input.groupId, input.accountId, input.member),
  );
