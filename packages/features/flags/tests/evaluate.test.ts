/**
 * Flag evaluation: the catalog is the closed set of outputs, `kill-only` can
 * never exceed the bundled default, and rollout/version/chain targeting is
 * local and deterministic.
 */
import { describe, expect, test } from "bun:test";
import type { FlagCatalog } from "@bramble/flags/catalog";
import { BUNDLED_FLAGS, TOGGLE_FLAGS } from "@bramble/flags/catalog";
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

  test("the shipped catalog declares kill-only unless it is a reviewed toggle flag", () => {
    for (const [key, known] of Object.entries(BUNDLED_FLAGS)) {
      expect(known.remote ?? "kill-only").toBe(TOGGLE_FLAGS.includes(key) ? "toggle" : "kill-only");
    }
  });

  test("every toggle flag ships off, so no document means hidden", () => {
    for (const key of TOGGLE_FLAGS) {
      expect(BUNDLED_FLAGS[key]).toMatchObject({ enabled: false, remote: "toggle" });
      expect(evaluateFlags(BUNDLED_FLAGS, null, TARGETING)[key]).toBe(false);
    }
  });

  test("qsb.vaults turns on only for a verified rule that targets this install", () => {
    const qsb = (rule: FlagRule, targeting: Partial<FlagTargeting> = {}) =>
      evaluateFlags(BUNDLED_FLAGS, docWith({ "qsb.vaults": rule }), { ...TARGETING, ...targeting })[
        "qsb.vaults"
      ];
    expect(qsb({ enabled: true })).toBe(true);
    expect(qsb({ enabled: false })).toBe(false);
    const sepoliaOnly: FlagRule = { chains: ["SN_SEPOLIA"], enabled: true };
    expect(qsb(sepoliaOnly)).toBe(false);
    expect(qsb(sepoliaOnly, { chain: "SN_SEPOLIA" })).toBe(true);
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

  test("an off-target kill-only rule kills the flag for that target", () => {
    const rule: FlagRule = { chains: ["SN_SEPOLIA"], enabled: true };
    expect(evaluate({ "a.killonly": rule }, { chain: "SN_MAIN" })["a.killonly"]).toBe(false);
    expect(evaluate({ "a.killonly": rule }, { chain: "SN_SEPOLIA" })["a.killonly"]).toBe(true);
  });
});
