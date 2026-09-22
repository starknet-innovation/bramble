/**
 * Pure, side-effect-free model for account groups ("folders"): non-secret,
 * organisational metadata that lets a user file each account under a named,
 * icon-tagged group. The model is a single-group folder: an account belongs to
 * AT MOST ONE group, so assigning it to a group removes it from every other.
 * The store keeps membership as per-group `accountIds`; the exclusivity is an
 * invariant enforced by {@link setAccountInGroup} on assignment and repaired by
 * {@link normalizeAccountGroups} when reading legacy data that predates it.
 * Group ids are derived deterministically from the name (slug plus a collision
 * suffix) so this module never reaches for a clock or randomness — every
 * operation is a pure function returning a fresh immutable array, validated the
 * same way the plain preferences store validates its other collections.
 */
import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, hasUniqueStrings, isRecord } from "@bramble/core/json";
import { isAccountId } from "@bramble/wallet-model/accounts";

/**
 * Curated Lucide glyphs offered for groups, driving the icon picker. Each name
 * is an existing key in the side panel `ICONS` map (enforced by `satisfies`),
 * so `icon(group.icon)` always resolves.
 */
export const GROUP_ICONS = [
  "wallet",
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
] as const;

/**
 * One of the allowed group icon names.
 */
export type AccountGroupIcon = (typeof GROUP_ICONS)[number];

/**
 * A user-named folder of accounts, tagged with a standardised icon. `id` is
 * derived from `name`; `accountIds` holds the member account ids (no order
 * guarantee, always de-duplicated). Under the single-group model an account id
 * appears in at most one group's `accountIds` across the whole collection.
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
    .replace(/^-|-$/g, "")
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
 * Removes the group with `id`. No-op when the id is unknown, and for either
 * default folder: the drawer needs both to exist, so they are renamed rather
 * than removed. Returns a new array.
 */
export const removeGroup = (groups: AccountGroups, id: string): AccountGroups =>
  isDefaultGroup(id) ? groups : groups.filter((group) => group.id !== id);

/**
 * Files an account into (`member: true`) or out of (`member: false`) the group
 * `groupId`, enforcing the single-group folder model: filing an account into a
 * group also removes it from every OTHER group, so it never belongs to two at
 * once. `member: false` just clears it from `groupId`, leaving it ungrouped.
 * A no-op when `groupId` is unknown (so an assignment to a stale id can never
 * silently strip an account from its real folder) or when membership already
 * matches. Throws {@link WalletError} for a malformed account id. Returns a new
 * array; groups whose membership is unchanged keep their identity.
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
  if (!groups.some((group) => group.id === groupId)) {
    return groups;
  }
  return groups.map((group) => {
    const has = group.accountIds.includes(accountId);
    // The target group holds the account iff `member`; every other group must
    // drop it on assignment (exclusivity) but is untouched on clearing.
    const shouldHave = group.id === groupId ? member : member ? false : has;
    if (shouldHave === has) {
      return group;
    }
    return {
      ...group,
      accountIds: shouldHave
        ? [...group.accountIds, accountId]
        : group.accountIds.filter((existing) => existing !== accountId),
    };
  });
};

/**
 * Resolves the single group an account is filed under, or null when it is
 * ungrouped. Returns the first group listing the account so a legacy record
 * with the account in several groups still yields one deterministically (the
 * same one {@link normalizeAccountGroups} keeps).
 */
export const accountGroup = (groups: AccountGroups, accountId: string): AccountGroup | null =>
  groups.find((group) => group.accountIds.includes(accountId)) ?? null;

/**
 * The two folders every wallet has. "My accounts" is where an account lives
 * until it is filed somewhere else — an account in no group is shown there, so
 * a new account needs no assignment to appear. "Archived accounts" starts
 * empty and always sorts last.
 *
 * Both are structural rather than user-made: they are ensured on every read and
 * refused by {@link removeGroup}, so the drawer always has somewhere to put an
 * account and somewhere to move it out of the way.
 */
export const DEFAULT_GROUP_IDS = {
  archived: "archived-accounts",
  home: "my-accounts",
} as const;

const DEFAULT_GROUPS: AccountGroups = [
  { accountIds: [], icon: "wallet", id: DEFAULT_GROUP_IDS.home, name: "My accounts" },
  { accountIds: [], icon: "folder", id: DEFAULT_GROUP_IDS.archived, name: "Archived accounts" },
];

/**
 * Whether a group is one of the two the wallet guarantees. A default folder can
 * be renamed and re-iconed like any other; it cannot be deleted, because the
 * drawer files every unassigned account into the first and offers the second as
 * the place to put an account away.
 */
export const isDefaultGroup = (id: string): boolean =>
  id === DEFAULT_GROUP_IDS.home || id === DEFAULT_GROUP_IDS.archived;

/**
 * The folder an account is shown in. An account filed into a group is shown
 * there; one in no group is shown in the home folder, so a new account appears
 * without a write. Returns null when `groups` has no home folder — callers
 * that install the default groups always have one, and a list without them has
 * nowhere to show an unfiled account.
 */
export const displayedAccountGroup = (
  groups: AccountGroups,
  accountId: string,
): AccountGroup | null =>
  accountGroup(groups, accountId) ??
  groups.find((group) => group.id === DEFAULT_GROUP_IDS.home) ??
  null;

/**
 * Returns the groups in display order with both defaults present: the home
 * folder first, then the user's own in their existing order, then the archive
 * last. Missing defaults are added, so a wallet that predates them — or one
 * whose stored list is empty — reads the same as a fresh one.
 */
export const withDefaultGroups = (groups: AccountGroups): AccountGroups => {
  // Already home-first and archive-last: return the input so a read that
  // changes nothing keeps its identity.
  if (
    groups.length >= 2 &&
    groups[0]?.id === DEFAULT_GROUP_IDS.home &&
    groups.at(-1)?.id === DEFAULT_GROUP_IDS.archived &&
    !groups.slice(1, -1).some((group) => isDefaultGroup(group.id))
  ) {
    return groups;
  }
  const known = (id: string): AccountGroup | undefined => groups.find((group) => group.id === id);
  const home = known(DEFAULT_GROUP_IDS.home) ?? DEFAULT_GROUPS[0];
  const archived = known(DEFAULT_GROUP_IDS.archived) ?? DEFAULT_GROUPS[1];
  const rest = groups.filter((group) => !isDefaultGroup(group.id));
  return home && archived ? [home, ...rest, archived] : groups;
};

/**
 * Repairs legacy data that predates the single-group model: an account listed
 * in several groups is kept in only the FIRST (in stable array order) and
 * dropped from the rest, so membership becomes exclusive without losing an
 * account entirely. Also ensures both default folders exist and sit in display
 * order, so every wallet reads the same whether or not it has seen them.
 * Returns the input unchanged when it already satisfies both, preserving
 * referential identity.
 */
export const normalizeAccountGroups = (groups: AccountGroups): AccountGroups => {
  const claimed = new Set<string>();
  const seeded = withDefaultGroups(groups);
  let changed = false;
  const next = seeded.map((group) => {
    const kept = group.accountIds.filter((id) => {
      if (claimed.has(id)) {
        changed = true;
        return false;
      }
      claimed.add(id);
      return true;
    });
    return kept.length === group.accountIds.length ? group : { ...group, accountIds: kept };
  });
  return changed || seeded !== groups ? next : groups;
};
