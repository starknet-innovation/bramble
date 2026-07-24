/**
 * Account-groups model checks: deterministic ids, collision suffixing, name
 * and icon validation, exclusive single-folder membership, resolving an
 * account's folder, normalising legacy multi-membership, removal, and
 * immutability.
 */
import { describe, expect, test } from "bun:test";
import {
  type AccountGroups,
  accountGroup,
  createGroup,
  GROUP_ICONS,
  isAccountGroup,
  isAccountGroupIcon,
  isAccountGroups,
  normalizeAccountGroups,
  removeGroup,
  renameGroup,
  setAccountInGroup,
  setGroupIcon,
} from "../../src/storage/account-groups";

const accountA = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const accountB = "SN_SEPOLIA:0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

describe("createGroup", () => {
  test("derives a deterministic slug id from the name", () => {
    const groups = createGroup([], "  Trading Desk!  ", "briefcase");
    expect(groups).toEqual([
      { accountIds: [], icon: "briefcase", id: "trading-desk", name: "Trading Desk!" },
    ]);
    expect(createGroup([], "Trading Desk!", "briefcase")[0]?.id).toBe("trading-desk");
  });

  test("suffixes ids to avoid collisions", () => {
    let groups: AccountGroups = createGroup([], "Savings", "piggyBank");
    groups = createGroup(groups, "Savings", "coins");
    groups = createGroup(groups, "Savings", "star");
    expect(groups.map((group) => group.id)).toEqual(["savings", "savings-2", "savings-3"]);
  });

  test("falls back to a stable id for names without alphanumerics", () => {
    const groups = createGroup([], "★☆", "star");
    expect(groups[0]?.id).toBe("group");
  });

  test("rejects invalid names and icons", () => {
    expect(() => createGroup([], "   ", "folder")).toThrow("Invalid group name");
    expect(() => createGroup([], "x".repeat(65), "folder")).toThrow("Invalid group name");
    expect(() => createGroup([], "Ok", "not-an-icon" as unknown as "folder")).toThrow(
      "Invalid group icon",
    );
    expect(createGroup([], "x".repeat(64), "folder")[0]?.name).toHaveLength(64);
  });

  test("does not mutate the input array", () => {
    const original: AccountGroups = [];
    const next = createGroup(original, "Team", "users");
    expect(original).toEqual([]);
    expect(next).not.toBe(original);
  });
});

describe("membership", () => {
  test("adds and removes account ids without duplicates", () => {
    let groups = createGroup([], "Team", "users");
    const id = groups[0]?.id ?? "";
    groups = setAccountInGroup(groups, id, accountA, true);
    groups = setAccountInGroup(groups, id, accountA, true);
    expect(groups[0]?.accountIds).toEqual([accountA]);
    groups = setAccountInGroup(groups, id, accountB, true);
    expect(groups[0]?.accountIds).toEqual([accountA, accountB]);
    groups = setAccountInGroup(groups, id, accountA, false);
    expect(groups[0]?.accountIds).toEqual([accountB]);
  });

  test("is a no-op for an unknown group and rejects bad account ids", () => {
    const groups = createGroup([], "Team", "users");
    expect(setAccountInGroup(groups, "missing", accountA, true)).toEqual(groups);
    expect(() => setAccountInGroup(groups, groups[0]?.id ?? "", "nope", true)).toThrow(
      "Invalid account id",
    );
  });
});

// Third account id used only by the bulk-membership suite (a distinct network
// prefix, exercising cross-network bucketing into one group).
const accountC = "SN_MAIN:0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

describe("bulk membership (group-centric editor)", () => {
  test("buckets several accounts into one group in successive toggles", () => {
    let groups = createGroup([], "Work", "briefcase");
    const id = groups[0]?.id ?? "";
    for (const account of [accountA, accountB, accountC]) {
      groups = setAccountInGroup(groups, id, account, true);
    }
    expect(groups[0]?.accountIds).toEqual([accountA, accountB, accountC]);
  });

  test("removes several accounts, leaving the untouched ones", () => {
    let groups = createGroup([], "Work", "briefcase");
    const id = groups[0]?.id ?? "";
    for (const account of [accountA, accountB, accountC]) {
      groups = setAccountInGroup(groups, id, account, true);
    }
    groups = setAccountInGroup(groups, id, accountA, false);
    groups = setAccountInGroup(groups, id, accountC, false);
    expect(groups[0]?.accountIds).toEqual([accountB]);
  });

  test("re-toggling the same membership is idempotent", () => {
    let groups = createGroup([], "Work", "briefcase");
    const id = groups[0]?.id ?? "";
    groups = setAccountInGroup(groups, id, accountA, true);
    const afterAdd = groups;
    // A no-op toggle preserves each group's identity (per-group referential
    // stability), even though the containing array is a fresh map result.
    groups = setAccountInGroup(groups, id, accountA, true);
    expect(groups).toEqual(afterAdd);
    expect(groups[0]).toBe(afterAdd[0]);
    groups = setAccountInGroup(groups, id, accountB, false);
    expect(groups).toEqual(afterAdd);
    expect(groups[0]).toBe(afterAdd[0]);
  });

  test("filing an account into a group removes it from its previous one (exclusive)", () => {
    let groups = createGroup(createGroup([], "Work", "briefcase"), "Personal", "user");
    const [work, personal] = [groups[0]?.id ?? "", groups[1]?.id ?? ""];
    groups = setAccountInGroup(groups, work, accountA, true);
    groups = setAccountInGroup(groups, work, accountB, true);
    expect(groups[0]?.accountIds).toEqual([accountA, accountB]);
    // Filing B into Personal moves it out of Work — an account is in one folder.
    groups = setAccountInGroup(groups, personal, accountB, true);
    expect(groups[0]?.accountIds).toEqual([accountA]);
    expect(groups[1]?.accountIds).toEqual([accountB]);
    // Clearing B leaves it ungrouped without disturbing A's folder.
    groups = setAccountInGroup(groups, personal, accountB, false);
    expect(groups[0]?.accountIds).toEqual([accountA]);
    expect(groups[1]?.accountIds).toEqual([]);
  });

  test("assigning to an unknown group is a no-op, never stripping a real folder", () => {
    let groups = createGroup([], "Work", "briefcase");
    const work = groups[0]?.id ?? "";
    groups = setAccountInGroup(groups, work, accountA, true);
    // A stale/unknown target must not remove the account from its real folder.
    expect(setAccountInGroup(groups, "missing", accountA, true)).toBe(groups);
    expect(groups[0]?.accountIds).toEqual([accountA]);
  });
});

describe("accountGroup", () => {
  test("resolves the single folder an account is filed under, or null", () => {
    let groups = createGroup(createGroup([], "Work", "briefcase"), "Personal", "user");
    const [work, personal] = [groups[0]?.id ?? "", groups[1]?.id ?? ""];
    expect(accountGroup(groups, accountA)).toBeNull();
    groups = setAccountInGroup(groups, personal, accountA, true);
    expect(accountGroup(groups, accountA)?.id).toBe(personal);
    // Exclusive assignment moves it, so exactly one folder ever resolves.
    groups = setAccountInGroup(groups, work, accountA, true);
    expect(accountGroup(groups, accountA)?.id).toBe(work);
  });
});

describe("normalizeAccountGroups", () => {
  test("collapses legacy multi-membership to the first group in stable order", () => {
    // Legacy data (predating the single-group model) with accountA in two groups.
    const legacy: AccountGroups = [
      { accountIds: [accountA, accountB], icon: "briefcase", id: "work", name: "Work" },
      { accountIds: [accountA], icon: "user", id: "personal", name: "Personal" },
    ];
    const normalized = normalizeAccountGroups(legacy);
    // accountA is kept only in the FIRST group; accountB (single) is untouched.
    expect(normalized[0]?.accountIds).toEqual([accountA, accountB]);
    expect(normalized[1]?.accountIds).toEqual([]);
  });

  test("returns the input unchanged when membership is already exclusive", () => {
    const clean: AccountGroups = [
      { accountIds: [accountA], icon: "briefcase", id: "work", name: "Work" },
      { accountIds: [accountB], icon: "user", id: "personal", name: "Personal" },
    ];
    expect(normalizeAccountGroups(clean)).toBe(clean);
  });
});

describe("renameGroup / setGroupIcon / removeGroup", () => {
  test("renames and re-icons only the matching group", () => {
    let groups = createGroup(createGroup([], "One", "folder"), "Two", "star");
    const [first, second] = [groups[0]?.id ?? "", groups[1]?.id ?? ""];
    groups = renameGroup(groups, first, "Primary");
    groups = setGroupIcon(groups, second, "rocket");
    expect(groups[0]).toMatchObject({ id: first, name: "Primary", icon: "folder" });
    expect(groups[1]).toMatchObject({ id: second, name: "Two", icon: "rocket" });
  });

  test("validates rename names and icons", () => {
    const groups = createGroup([], "One", "folder");
    expect(() => renameGroup(groups, groups[0]?.id ?? "", "")).toThrow("Invalid group name");
    expect(() => setGroupIcon(groups, groups[0]?.id ?? "", "bad" as unknown as "folder")).toThrow(
      "Invalid group icon",
    );
  });

  test("removes a group and leaves the rest", () => {
    const groups = createGroup(createGroup([], "One", "folder"), "Two", "star");
    const removed = removeGroup(groups, groups[0]?.id ?? "");
    expect(removed).toHaveLength(1);
    expect(removed[0]?.name).toBe("Two");
    expect(removeGroup(groups, "missing")).toHaveLength(2);
  });
});

describe("validators", () => {
  test("accepts every declared group icon and rejects others", () => {
    for (const glyph of GROUP_ICONS) {
      expect(isAccountGroupIcon(glyph)).toBe(true);
    }
    expect(isAccountGroupIcon("send")).toBe(false);
    expect(isAccountGroupIcon(42)).toBe(false);
  });

  test("isAccountGroup checks id, name, icon, and member ids", () => {
    expect(
      isAccountGroup({ accountIds: [accountA], icon: "folder", id: "team", name: "Team" }),
    ).toBe(true);
    expect(isAccountGroup({ accountIds: [], icon: "send", id: "team", name: "Team" })).toBe(false);
    expect(isAccountGroup({ accountIds: ["nope"], icon: "folder", id: "team", name: "Team" })).toBe(
      false,
    );
    expect(
      isAccountGroup({
        accountIds: [accountA, accountA],
        icon: "folder",
        id: "team",
        name: "Team",
      }),
    ).toBe(false);
    expect(isAccountGroup({ accountIds: [], icon: "folder", id: "Team", name: "Team" })).toBe(
      false,
    );
    expect(isAccountGroup({ accountIds: [], icon: "folder", id: "team", name: "" })).toBe(false);
    expect(
      isAccountGroup({ accountIds: [], extra: 1, icon: "folder", id: "team", name: "Team" }),
    ).toBe(false);
  });

  test("isAccountGroups rejects duplicate ids", () => {
    const one = { accountIds: [], icon: "folder" as const, id: "team", name: "Team" };
    expect(isAccountGroups([one])).toBe(true);
    expect(isAccountGroups([one, one])).toBe(false);
    expect(isAccountGroups("nope")).toBe(false);
  });
});
