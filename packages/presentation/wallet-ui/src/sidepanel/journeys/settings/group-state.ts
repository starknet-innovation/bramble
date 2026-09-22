/**
 * Pure self-healing for the side panel's transient account-group UI state: the
 * manage-accounts expanded group. Group ids are derived deterministically from
 * the name, so a stale id pointing at a deleted group must be dropped —
 * otherwise it could silently re-apply itself once a same-named group is
 * recreated. Kept pure and out of the entrypoint so it can be unit tested and
 * reused without reaching for the DOM.
 */
import type { AccountGroups } from "@bramble/settings/groups";

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
 * The transient, per-session group UI selection held in the side panel
 * entrypoint: an id (or null) that only makes sense while the referenced group
 * still exists.
 */
export type TransientGroupState = {
  /**
   * Drawer folders the user has collapsed. Ids of deleted folders are dropped,
   * so a later folder that reuses the same slug does not open already closed.
   */
  readonly collapsedFolderIds?: readonly string[];
  readonly expandedGroupId: string | null;
};

/**
 * Returns a copy of `state` with selections whose groups are gone removed.
 * A selection that still resolves passes through unchanged. The
 * {@link CREATE_GROUP_PANEL} sentinel is not a group id, so it is kept as-is
 * rather than healed away. Collapsed folder ids are returned only when the
 * caller passed them, and only the ids that still name a group.
 */
export const healTransientGroupState = (
  state: TransientGroupState,
  groups: AccountGroups,
): TransientGroupState => {
  const known = new Set(groups.map((group) => group.id));
  const keep =
    state.expandedGroupId === CREATE_GROUP_PANEL ||
    (state.expandedGroupId !== null && known.has(state.expandedGroupId));
  const healed: TransientGroupState = {
    expandedGroupId: keep ? state.expandedGroupId : null,
  };
  if (state.collapsedFolderIds === undefined) {
    return healed;
  }
  return {
    ...healed,
    collapsedFolderIds: state.collapsedFolderIds.filter((id) => known.has(id)),
  };
};
