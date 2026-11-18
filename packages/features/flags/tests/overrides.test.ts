/**
 * Local overrides: only catalog flags marked `localOverride` can be stored or
 * applied, a remote hard kill always wins, malformed records read as empty,
 * and store failures never throw.
 */
import { describe, expect, test } from "bun:test";
import { BUNDLED_FLAGS, type FlagCatalog } from "@bramble/flags/catalog";
import { type FlagRule, parseFlagPayload } from "@bramble/flags/contract";
import { flagKills } from "@bramble/flags/evaluate";
import {
  applyFlagOverrides,
  FEATURE_FLAG_OVERRIDES_KEY,
  isOverridableFlag,
  overridableFlags,
  readFlagOverrides,
  writeFlagOverrides,
} from "@bramble/flags/overrides";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import { payload } from "./support/flag-fixture";

const CATALOG: FlagCatalog = {
  "a.locked": { enabled: true },
  "b.open": { enabled: false, localOverride: true, remote: "toggle" },
  "c.open": { enabled: true, localOverride: true },
};

const BASE = { "a.locked": true, "b.open": false, "c.open": true };

const docWith = (flags: Record<string, FlagRule>) => parseFlagPayload(payload({ flags }));

const failingStore: KeyValueStore = {
  get: async () => {
    throw new Error("down");
  },
  remove: async () => {
    throw new Error("down");
  },
  set: async () => {
    throw new Error("down");
  },
};

describe("overridable flags", () => {
  test("only flags that opt in are overridable", () => {
    expect(overridableFlags(CATALOG)).toEqual(["b.open", "c.open"]);
    expect(isOverridableFlag(CATALOG, "b.open")).toBe(true);
    expect(isOverridableFlag(CATALOG, "a.locked")).toBe(false);
    expect(isOverridableFlag(CATALOG, "missing")).toBe(false);
    expect(isOverridableFlag(CATALOG, "__proto__")).toBe(false);
    expect(isOverridableFlag(CATALOG, 1)).toBe(false);
  });

  test("the shipped catalog keeps every flag closed until a release opts it in", () => {
    expect(overridableFlags(BUNDLED_FLAGS)).toEqual([]);
  });
});

describe("override storage", () => {
  test("round-trips, and an empty set removes the record", async () => {
    const store = createMemoryStore();
    expect(await writeFlagOverrides(store, { "b.open": true })).toBe(true);
    expect(await readFlagOverrides(store, CATALOG)).toEqual({ "b.open": true });
    expect(await writeFlagOverrides(store, {})).toBe(true);
    expect(await store.get(FEATURE_FLAG_OVERRIDES_KEY)).toBeUndefined();
  });

  test("drops entries this build does not allow", async () => {
    const store = createMemoryStore();
    await store.set(FEATURE_FLAG_OVERRIDES_KEY, {
      flags: { "a.locked": false, "b.open": "yes", "c.open": false, unknown: true },
      schemaVersion: 1,
    });
    expect(await readFlagOverrides(store, CATALOG)).toEqual({ "c.open": false });
  });

  test.each([
    ["absent", undefined],
    ["wrong version", { flags: { "b.open": true }, schemaVersion: 2 }],
    ["extra field", { extra: 1, flags: { "b.open": true }, schemaVersion: 1 }],
    ["flags not an object", { flags: ["b.open"], schemaVersion: 1 }],
    ["not a record", "b.open=true"],
  ])("a %s record reads as no overrides", async (_name, value) => {
    const store = createMemoryStore();
    if (value !== undefined) await store.set(FEATURE_FLAG_OVERRIDES_KEY, value);
    expect(await readFlagOverrides(store, CATALOG)).toEqual({});
  });

  test("store failures read as empty and report a failed write", async () => {
    expect(await readFlagOverrides(failingStore, CATALOG)).toEqual({});
    expect(await writeFlagOverrides(failingStore, { "b.open": true })).toBe(false);
    expect(await writeFlagOverrides(failingStore, {})).toBe(false);
  });
});

describe("applyFlagOverrides", () => {
  test("no overrides leaves the evaluated values untouched", () => {
    expect(applyFlagOverrides(BASE, {}, CATALOG, [])).toEqual({
      flags: BASE,
      killed: [],
      overridden: [],
    });
  });

  test("an override replaces the evaluated value in either direction", () => {
    expect(applyFlagOverrides(BASE, { "b.open": true, "c.open": false }, CATALOG, [])).toEqual({
      flags: { "a.locked": true, "b.open": true, "c.open": false },
      killed: [],
      overridden: ["b.open", "c.open"],
    });
  });

  test("an override beats remote targeting that leaves the flag off", () => {
    const doc = docWith({ "b.open": { enabled: true, rollout: 0 } });
    expect(
      applyFlagOverrides(BASE, { "b.open": true }, CATALOG, flagKills(CATALOG, doc)).flags[
        "b.open"
      ],
    ).toBe(true);
  });

  test("a remote hard kill beats an override", () => {
    const doc = docWith({ "b.open": { enabled: false }, "c.open": { enabled: false } });
    const killedBase = { ...BASE, "c.open": false };
    expect(
      applyFlagOverrides(
        killedBase,
        { "b.open": true, "c.open": true },
        CATALOG,
        flagKills(CATALOG, doc),
      ),
    ).toEqual({
      flags: killedBase,
      killed: ["b.open", "c.open"],
      overridden: [],
    });
  });

  test("overrides for flags that are not overridable are ignored", () => {
    expect(applyFlagOverrides(BASE, { "a.locked": false }, CATALOG, [])).toEqual({
      flags: BASE,
      killed: [],
      overridden: [],
    });
  });
});
