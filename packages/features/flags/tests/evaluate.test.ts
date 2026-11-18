/**
 * Flag evaluation: the catalog is the closed set of outputs, `kill-only` can
 * never exceed the bundled default, and rollout/version/chain targeting is
 * local and deterministic.
 */
import { describe, expect, test } from "bun:test";
import type { FlagCatalog } from "@bramble/flags/catalog";
import { BUNDLED_FLAGS } from "@bramble/flags/catalog";
import { type FlagRule, parseFlagPayload } from "@bramble/flags/contract";
import { evaluateFlags, type FlagTargeting, flagBucket } from "@bramble/flags/evaluate";
import { payload } from "./support/flag-fixture";

const CATALOG: FlagCatalog = {
  "a.killonly": { enabled: true },
  "b.killonly-off": { enabled: false, remote: "kill-only" },
  "c.toggle": { enabled: false, remote: "toggle" },
};

const TARGETING: FlagTargeting = { bucket: 0, chain: "SN_MAIN", version: "0.10.0" };

const docWith = (flags: Record<string, FlagRule>) => parseFlagPayload(payload({ flags }));

const evaluate = (flags: Record<string, FlagRule>, targeting: Partial<FlagTargeting> = {}) =>
  evaluateFlags(CATALOG, docWith(flags), { ...TARGETING, ...targeting });

describe("evaluateFlags", () => {
  test("no document yields exactly the bundled defaults", () => {
    expect(evaluateFlags(CATALOG, null, TARGETING)).toEqual({
      "a.killonly": true,
      "b.killonly-off": false,
      "c.toggle": false,
    });
  });

  test("the shipped catalog declares kill-only unless stated otherwise", () => {
    for (const known of Object.values(BUNDLED_FLAGS)) {
      expect(known.remote ?? "kill-only").toBe("kill-only");
    }
  });

  test("unknown remote flags are ignored and cannot add outputs", () => {
    const values = evaluate({ "z.unknown": { enabled: true } });
    expect(Object.keys(values).sort()).toEqual(["a.killonly", "b.killonly-off", "c.toggle"]);
  });

  test("kill-only flags can be turned off remotely", () => {
    expect(evaluate({ "a.killonly": { enabled: false } })["a.killonly"]).toBe(false);
  });

  test("kill-only flags are never turned on beyond the bundled default", () => {
    expect(evaluate({ "b.killonly-off": { enabled: true } })["b.killonly-off"]).toBe(false);
  });

  test("toggle flags follow the remote decision both ways", () => {
    expect(evaluate({ "c.toggle": { enabled: true } })["c.toggle"]).toBe(true);
    expect(
      evaluateFlags({ t: { enabled: true, remote: "toggle" } } as FlagCatalog, null, TARGETING)[
        "t"
      ],
    ).toBe(true);
  });

  test("rollout admits exactly the buckets below the threshold", () => {
    const key = "c.toggle";
    const position = flagBucket(key, 1234);
    const on = evaluate({ [key]: { enabled: true, rollout: position + 1 } }, { bucket: 1234 });
    const off = evaluate({ [key]: { enabled: true, rollout: position } }, { bucket: 1234 });
    expect(on[key]).toBe(true);
    expect(off[key]).toBe(false);
    expect(evaluate({ [key]: { enabled: true, rollout: 0 } })[key]).toBe(false);
    expect(evaluate({ [key]: { enabled: true, rollout: 10_000 } }, { bucket: 9999 })[key]).toBe(
      true,
    );
  });

  test("rollout positions differ per flag but stay in range and stable", () => {
    expect(flagBucket("a.one", 42)).not.toBe(flagBucket("a.two", 42));
    expect(flagBucket("a.one", 42)).toBe(flagBucket("a.one", 42));
    for (const bucket of [0, 5000, 9999]) {
      const position = flagBucket("swap.enabled", bucket);
      expect(position >= 0 && position < 10_000).toBe(true);
    }
  });

  test("version gating is inclusive and fails closed on an unreadable version", () => {
    const rule = { enabled: true, maxVersion: "0.10.0", minVersion: "0.10.0" };
    expect(evaluate({ "c.toggle": rule })["c.toggle"]).toBe(true);
    expect(evaluate({ "c.toggle": rule }, { version: "0.10.1" })["c.toggle"]).toBe(false);
    expect(evaluate({ "c.toggle": rule }, { version: "0.9.0" })["c.toggle"]).toBe(false);
    expect(evaluate({ "c.toggle": rule }, { version: null })["c.toggle"]).toBe(false);
    expect(evaluate({ "c.toggle": rule }, { version: "0.10.0.1" })["c.toggle"]).toBe(false);
  });

  test("chain gating matches the active chain only", () => {
    const rule: FlagRule = { chains: ["SN_SEPOLIA"], enabled: true };
    expect(evaluate({ "c.toggle": rule }, { chain: "SN_SEPOLIA" })["c.toggle"]).toBe(true);
    expect(evaluate({ "c.toggle": rule }, { chain: "SN_MAIN" })["c.toggle"]).toBe(false);
    expect(evaluate({ "c.toggle": rule }, { chain: "SN_DEVNET" })["c.toggle"]).toBe(false);
    expect(evaluate({ "c.toggle": rule }, { chain: null })["c.toggle"]).toBe(false);
  });

  test("without an install bucket a kill applies and rollout rules keep the default", () => {
    const targeting = { bucket: null };
    expect(evaluate({ "a.killonly": { enabled: false } }, targeting)["a.killonly"]).toBe(false);
    expect(evaluate({ "c.toggle": { enabled: false } }, targeting)["c.toggle"]).toBe(false);
    // A kill with a rollout is still a kill: it can never turn the flag on.
    expect(
      evaluate({ "a.killonly": { enabled: false, rollout: 1 } }, targeting)["a.killonly"],
    ).toBe(false);
    // Rollout-dependent "on" rules cannot be decided: the bundled default stays.
    expect(evaluate({ "a.killonly": { enabled: true, rollout: 1 } }, targeting)["a.killonly"]).toBe(
      true,
    );
    expect(evaluate({ "c.toggle": { enabled: true, rollout: 9999 } }, targeting)["c.toggle"]).toBe(
      false,
    );
    // Rules without a rollout need no bucket.
    expect(evaluate({ "c.toggle": { enabled: true } }, targeting)["c.toggle"]).toBe(true);
  });

  test("an off-target kill-only rule kills the flag for that target", () => {
    const rule: FlagRule = { chains: ["SN_SEPOLIA"], enabled: true };
    expect(evaluate({ "a.killonly": rule }, { chain: "SN_MAIN" })["a.killonly"]).toBe(false);
    expect(evaluate({ "a.killonly": rule }, { chain: "SN_SEPOLIA" })["a.killonly"]).toBe(true);
  });
});
