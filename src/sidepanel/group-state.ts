/**
 * Pure self-healing for the side panel's transient account-group UI state: the
 * drawer's selected group filter, the manage-accounts expanded group, and the
 * drawer's open assign panel. Group ids are derived deterministically from the
 * name, so a stale id pointing at a deleted group (or an account that has gone
 * away) must be dropped — otherwise it could silently re-apply itself once a
 * same-named group is recreated, or reopen a panel for an account no longer on
 * the current network. Kept pure and out of the entrypoint so it can be unit
 * tested and reused without reaching for the DOM.
 */
import type { AccountGroups } from "../storage/account-groups";

/**
 * The transient, per-session group UI selections held in the side panel
 * entrypoint. Each is an id (or null) that only makes sense while the referenced
 * group or account still exists.
 */
export type TransientGroupState = {
  readonly drawerGroupFilter: string | null;
  readonly expandedGroupId: string | null;
  readonly openAssignId: string | null;
};

/**
 * Returns a copy of `state` with any selection dropped that no longer resolves:
 * a group filter or expanded group whose group id is gone, or an open assign
 * panel whose account id is gone. Selections that still resolve pass through
 * unchanged.
 */
export const healTransientGroupState = (
  state: TransientGroupState,
  groups: AccountGroups,
  accountIds: readonly string[],
): TransientGroupState => {
  const hasGroup = (id: string | null): boolean =>
    id !== null && groups.some((group) => group.id === id);
  const hasAccount = (id: string | null): boolean => id !== null && accountIds.includes(id);
  return {
    drawerGroupFilter: hasGroup(state.drawerGroupFilter) ? state.drawerGroupFilter : null,
    expandedGroupId: hasGroup(state.expandedGroupId) ? state.expandedGroupId : null,
    openAssignId: hasAccount(state.openAssignId) ? state.openAssignId : null,
  };
};
