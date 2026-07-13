/**
 * Pure, side-effect-free model for account groups ("folders"): non-secret,
 * organisational metadata that lets a user bucket accounts under a named,
 * icon-tagged group. An account may belong to several groups. Group ids are
 * derived deterministically from the name (slug plus a collision suffix) so
 * this module never reaches for a clock or randomness — every operation is a
 * pure function returning a fresh immutable array, validated the same way the
 * plain preferences store validates its other collections.
 */
import { WalletError } from "../shared/errors";
import { hasOnlyKnownKeys, hasUniqueStrings, isRecord } from "../shared/json";
import type { IconName } from "../sidepanel/icons";
import { isAccountId } from "./vault-schema";

/**
 * Curated Lucide glyphs offered for groups, driving the icon picker. Each name
 * is an existing key in the side panel `ICONS` map (enforced by `satisfies`),
 * so `icon(group.icon)` always resolves.
 */
export const GROUP_ICONS = [
  "folder",
  "briefcase",
  "user",
  "users",
  "trendingUp",
  "piggyBank",
  "landmark",
  "coins",
  "gift",
  "star",
  "heart",
  "shield",
  "flame",
  "rocket",
  "building",
  "graduationCap",
  "gamepad",
  "leaf",
] as const satisfies readonly IconName[];

/**
 * One of the allowed group icon names.
 */
export type AccountGroupIcon = (typeof GROUP_ICONS)[number];

/**
 * A user-named bucket of accounts, tagged with a standardised icon. `id` is
 * derived from `name`; `accountIds` holds the member account ids (no order
 * guarantee, always de-duplicated).
 */
export type AccountGroup = {
  readonly id: string;
  readonly name: string;
  readonly icon: AccountGroupIcon;
  readonly accountIds: readonly string[];
};

/**
 * An immutable list of account groups, one entry per distinct id.
 */
export type AccountGroups = readonly AccountGroup[];

/**
 * Group name rule mirroring the account-label rule in the preferences store:
 * a trimmed, non-empty string of at most 64 characters.
 */
const isGroupName = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= 64;

const isGroupId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 80 &&
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

/**
 * Checks a value is one of the allowed group icon names.
 */
export const isAccountGroupIcon = (value: unknown): value is AccountGroupIcon =>
  typeof value === "string" && (GROUP_ICONS as readonly string[]).includes(value);

/**
 * Validates a single stored group record and its member account ids.
 */
export const isAccountGroup = (value: unknown): value is AccountGroup =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountIds", "icon", "id", "name"]) &&
  isGroupId(value["id"]) &&
  isGroupName(value["name"]) &&
  isAccountGroupIcon(value["icon"]) &&
  Array.isArray(value["accountIds"]) &&
  value["accountIds"].every(isAccountId) &&
  hasUniqueStrings(value["accountIds"]);

/**
 * Validates the stored groups collection: every entry valid, ids unique.
 */
export const isAccountGroups = (value: unknown): value is AccountGroups =>
  Array.isArray(value) &&
  value.every(isAccountGroup) &&
  hasUniqueStrings(value.map((group) => group.id));

// Deterministic slug: lowercase, non-alphanumeric runs collapse to a single
// dash, edge dashes trimmed. An all-symbol name (empty slug) falls back to
// "group" so a valid id always exists.
const slugify = (name: string): string => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug.length > 0 ? slug : "group";
};

// Derives a collision-free id from the name: the base slug, or the base plus a
// numeric suffix (-2, -3, …) against the ids already present. Deterministic:
// the same name against the same set of groups always yields the same id.
const deriveGroupId = (groups: AccountGroups, name: string): string => {
  const base = slugify(name);
  if (!groups.some((group) => group.id === base)) {
    return base;
  }
  let suffix = 2;
  while (groups.some((group) => group.id === `${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
};

/**
 * Appends a new group with a deterministic, collision-free id. Throws
 * {@link WalletError} for an invalid name or icon. Returns a new array.
 */
export const createGroup = (
  groups: AccountGroups,
  name: string,
  icon: AccountGroupIcon,
): AccountGroups => {
  if (!isGroupName(name)) {
    throw new WalletError("Invalid group name");
  }
  if (!isAccountGroupIcon(icon)) {
    throw new WalletError("Invalid group icon");
  }
  return [...groups, { accountIds: [], icon, id: deriveGroupId(groups, name), name: name.trim() }];
};

/**
 * Renames the group with `id`. No-op when the id is unknown. Throws
 * {@link WalletError} for an invalid name. Returns a new array.
 */
export const renameGroup = (groups: AccountGroups, id: string, name: string): AccountGroups => {
  if (!isGroupName(name)) {
    throw new WalletError("Invalid group name");
  }
  return groups.map((group) => (group.id === id ? { ...group, name: name.trim() } : group));
};

/**
 * Sets the icon of the group with `id`. No-op when the id is unknown. Throws
 * {@link WalletError} for an invalid icon. Returns a new array.
 */
export const setGroupIcon = (
  groups: AccountGroups,
  id: string,
  icon: AccountGroupIcon,
): AccountGroups => {
  if (!isAccountGroupIcon(icon)) {
    throw new WalletError("Invalid group icon");
  }
  return groups.map((group) => (group.id === id ? { ...group, icon } : group));
};

/**
 * Removes the group with `id`. No-op when the id is unknown. Returns a new
 * array.
 */
export const removeGroup = (groups: AccountGroups, id: string): AccountGroups =>
  groups.filter((group) => group.id !== id);

/**
 * Adds or removes an account id from a group's membership, de-duplicating on
 * add. No-op when the group is missing or the membership already matches.
 * Throws {@link WalletError} for a malformed account id. Returns a new array.
 */
export const setAccountInGroup = (
  groups: AccountGroups,
  groupId: string,
  accountId: string,
  member: boolean,
): AccountGroups => {
  if (!isAccountId(accountId)) {
    throw new WalletError("Invalid account id");
  }
  return groups.map((group) => {
    if (group.id !== groupId) {
      return group;
    }
    const has = group.accountIds.includes(accountId);
    if (member === has) {
      return group;
    }
    return {
      ...group,
      accountIds: member
        ? [...group.accountIds, accountId]
        : group.accountIds.filter((existing) => existing !== accountId),
    };
  });
};
