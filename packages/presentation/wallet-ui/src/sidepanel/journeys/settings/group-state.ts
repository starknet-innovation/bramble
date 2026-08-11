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
import type { AccountGroups } from "@mc-wallet/settings/groups";

/**
 * Sentinel `expandedGroupId` value for the manage-accounts "Create a group"
 * accordion panel. It shares the one expanded-panel selector with the per-group
 * editors so opening the create panel collapses any open group (and vice
 * versa) — only ever one panel expanded. The underscores keep it outside the
 * group-id slug grammar (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), so it can never collide
 * with a real group id, and {@link healTransientGroupState} preserves it rather
 * than treating it as a stale (deleted-group) id.
 */
export const CREATE_GROUP_PANEL = "__create__";

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
 * unchanged. The {@link CREATE_GROUP_PANEL} sentinel is not a group id, so it is
 * kept as-is rather than healed away.
 */
export const healTransientGroupState = (
  state: TransientGroupState,
  groups: AccountGroups,
  accountIds: readonly string[],
): TransientGroupState => {
  const hasGroup = (id: string | null): boolean =>
    id !== null && groups.some((group) => group.id === id);
  const hasAccount = (id: string | null): boolean => id !== null && accountIds.includes(id);
  const keepExpanded =
    state.expandedGroupId === CREATE_GROUP_PANEL || hasGroup(state.expandedGroupId);
  return {
    drawerGroupFilter: hasGroup(state.drawerGroupFilter) ? state.drawerGroupFilter : null,
    expandedGroupId: keepExpanded ? state.expandedGroupId : null,
    openAssignId: hasAccount(state.openAssignId) ? state.openAssignId : null,
  };
};
