/**
 * Unit checks for the pure self-healing of the side panel's transient
 * account-group selection: an expanded group whose group is gone is dropped; a
 * live selection passes through untouched.
 */
import { describe, expect, test } from "bun:test";
import type { AccountGroups } from "@bramble/settings/groups";
import {
  CREATE_GROUP_PANEL,
  healTransientGroupState,
} from "../../../../src/sidepanel/journeys/settings/group-state";

const groups: AccountGroups = [
  { accountIds: ["SN_MAIN:0xabc"], icon: "folder", id: "work", name: "Work" },
  { accountIds: [], icon: "star", id: "savings", name: "Savings" },
];

describe("healTransientGroupState", () => {
  test("keeps an expanded group that still resolves", () => {
    expect(healTransientGroupState({ expandedGroupId: "savings" }, groups)).toEqual({
      expandedGroupId: "savings",
    });
  });

  test("drops an expanded group whose group was deleted", () => {
    expect(healTransientGroupState({ expandedGroupId: "also-gone" }, groups).expandedGroupId).toBe(
      null,
    );
  });

  test("drops collapsed folders that were deleted and keeps the ones that remain", () => {
    expect(
      healTransientGroupState(
        { collapsedFolderIds: ["savings", "gone", "work"], expandedGroupId: null },
        groups,
      ).collapsedFolderIds,
    ).toEqual(["savings", "work"]);
  });

  test("leaves collapsed folders untouched when the caller did not pass them", () => {
    expect(healTransientGroupState({ expandedGroupId: "savings" }, groups).collapsedFolderIds).toBe(
      undefined,
    );
  });

  test("keeps the Create a group panel sentinel (not a group id) across a heal", () => {
    // The sentinel is a UI mode, not a deleted-group id, so it must survive.
    expect(
      healTransientGroupState({ expandedGroupId: CREATE_GROUP_PANEL }, groups).expandedGroupId,
    ).toBe(CREATE_GROUP_PANEL);
  });
});
