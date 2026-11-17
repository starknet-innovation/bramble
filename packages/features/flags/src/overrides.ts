/**
 * Local feature-flag overrides: an advanced user's own choice for a flag,
 * applied on top of the bundled default and the signed remote flags.
 *
 * Bounded by the catalog: only flags that declare `localOverride: true` can be
 * overridden, and a stored entry for any other key is dropped on read. A
 * remote hard kill (a rule with `enabled: false`) always beats an override, so
 * the publisher's kill switch stays a guarantee rather than a suggestion.
 *
 * Overrides are plain, non-secret device state. They are never sent anywhere,
 * never exported with preferences, and a malformed record reads as "no
 * overrides". Store failures never throw out of these helpers.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type { KeyValueStore } from "@bramble/store/kv";
import type { FlagCatalog } from "./catalog";
import type { FlagPayload } from "./contract";
import type { FlagValues } from "./evaluate";

/** Storage key for the local override record. */
export const FEATURE_FLAG_OVERRIDES_KEY = "bramble:feature-flag-overrides";

const OVERRIDES_VERSION = 1;

/** A user's local choice per overridable flag. */
export type FlagOverrides = Readonly<Record<string, boolean>>;

/** Effective values after overrides, plus which flags each rule touched. */
export type OverriddenFlagValues = {
  readonly flags: FlagValues;
  /** Overridable flags the remote document has hard-killed; overrides ignored. */
  readonly killed: readonly string[];
  /** Flags whose effective value comes from a local override. */
  readonly overridden: readonly string[];
};

/** Keys in `catalog` that a user may override, sorted. */
export const overridableFlags = (catalog: FlagCatalog): readonly string[] =>
  Object.entries(catalog)
    .filter(([, known]) => known.localOverride === true)
    .map(([key]) => key)
    .sort();

/** Whether `key` names a flag a user may override in this build. */
export const isOverridableFlag = (catalog: FlagCatalog, key: unknown): key is string =>
  typeof key === "string" && Object.hasOwn(catalog, key) && catalog[key]?.localOverride === true;

/** Keeps only overridable keys with boolean values. */
const sanitize = (catalog: FlagCatalog, flags: Record<string, unknown>): FlagOverrides => {
  const kept: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(flags)) {
    if (isOverridableFlag(catalog, key) && typeof value === "boolean") {
      kept[key] = value;
    }
  }
  return kept;
};

/**
 * Reads the stored overrides, keeping only entries this build allows. Absent,
 * malformed, or unreadable records read as no overrides.
 */
export const readFlagOverrides = async (
  store: KeyValueStore,
  catalog: FlagCatalog,
): Promise<FlagOverrides> => {
  const value = await store.get(FEATURE_FLAG_OVERRIDES_KEY).catch(() => undefined);
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["flags", "schemaVersion"]) ||
    value["schemaVersion"] !== OVERRIDES_VERSION ||
    !isRecord(value["flags"])
  ) {
    return {};
  }
  return sanitize(catalog, value["flags"]);
};

/**
 * Persists overrides (removing the record when empty). Resolves false when
 * the store refused the write, so the caller can report that nothing changed.
 */
export const writeFlagOverrides = async (
  store: KeyValueStore,
  overrides: FlagOverrides,
): Promise<boolean> => {
  const write =
    Object.keys(overrides).length === 0
      ? store.remove(FEATURE_FLAG_OVERRIDES_KEY)
      : store.set(FEATURE_FLAG_OVERRIDES_KEY, {
          flags: { ...overrides },
          schemaVersion: OVERRIDES_VERSION,
        });
  return write.then(
    () => true,
    () => false,
  );
};

/** Whether the remote document hard-kills `key` (a rule with `enabled: false`). */
const hardKilled = (payload: FlagPayload | null, key: string): boolean =>
  payload !== null && Object.hasOwn(payload.flags, key) && payload.flags[key]?.enabled === false;

/**
 * Applies overrides to evaluated values. Pure. Order, highest first: remote
 * hard kill, local override, the evaluated value (remote rule or bundled
 * default). Overrides for flags outside `catalog` or not overridable are
 * ignored; `payload` must be the verified, unexpired document or null.
 */
export const applyFlagOverrides = (
  values: FlagValues,
  overrides: FlagOverrides,
  catalog: FlagCatalog,
  payload: FlagPayload | null,
): OverriddenFlagValues => {
  const flags: Record<string, boolean> = { ...values };
  const killed: string[] = [];
  const overridden: string[] = [];
  for (const key of overridableFlags(catalog)) {
    if (hardKilled(payload, key)) {
      killed.push(key);
      continue;
    }
    const choice = Object.hasOwn(overrides, key) ? overrides[key] : undefined;
    if (typeof choice === "boolean") {
      flags[key] = choice;
      overridden.push(key);
    }
  }
  return { flags, killed, overridden };
};
