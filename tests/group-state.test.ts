/**
 * Unit checks for the pure self-healing of the side panel's transient
 * account-group selections: a filter or expanded group whose group is gone, and
 * an open assign panel whose account is gone, are dropped; live selections pass
 * through untouched.
 */
import { describe, expect, test } from "bun:test";
import { healTransientGroupState } from "../src/sidepanel/group-state";
import type { AccountGroups } from "../src/storage/account-groups";

const groups: AccountGroups = [
  { accountIds: ["SN_MAIN:0xabc"], icon: "folder", id: "work", name: "Work" },
  { accountIds: [], icon: "star", id: "savings", name: "Savings" },
];

describe("healTransientGroupState", () => {
  test("keeps selections that still resolve", () => {
    const healed = healTransientGroupState(
      { drawerGroupFilter: "work", expandedGroupId: "savings", openAssignId: "SN_MAIN:0xabc" },
      groups,
      ["SN_MAIN:0xabc"],
    );

    expect(healed).toEqual({
      drawerGroupFilter: "work",
      expandedGroupId: "savings",
      openAssignId: "SN_MAIN:0xabc",
    });
  });

  test("drops a filter and expanded group whose group was deleted", () => {
    const healed = healTransientGroupState(
      { drawerGroupFilter: "gone", expandedGroupId: "also-gone", openAssignId: null },
      groups,
      ["SN_MAIN:0xabc"],
    );

    expect(healed.drawerGroupFilter).toBeNull();
    expect(healed.expandedGroupId).toBeNull();
  });

  test("drops an open assign panel whose account is gone", () => {
    const healed = healTransientGroupState(
      { drawerGroupFilter: null, expandedGroupId: null, openAssignId: "SN_MAIN:0xdead" },
      groups,
      ["SN_MAIN:0xabc"],
    );

    expect(healed.openAssignId).toBeNull();
  });
});
