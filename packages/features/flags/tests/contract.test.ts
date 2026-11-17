/**
 * Strict field validation of the v1 payload: every level is closed-world, and
 * every bound the publisher enforces is enforced again on the wallet side.
 */
import { describe, expect, test } from "bun:test";
import {
  compareFlagVersions,
  FlagContractError,
  type FlagRule,
  isFlagKey,
  parseFlagPayload,
  parseFlagTimestamp,
} from "@mc-wallet/flags/contract";
import { NOW, payload, stamp } from "./support/flag-fixture";

const rejects = (value: unknown): void => {
  expect(() => parseFlagPayload(value)).toThrow(FlagContractError);
};

const withRule = (rule: unknown) => payload({ flags: { "swap.enabled": rule } });

describe("parseFlagPayload", () => {
  test("accepts a full rule and normalizes timestamps to epoch ms", () => {
    const rule: FlagRule = {
      chains: ["SN_SEPOLIA"],
      enabled: true,
      maxVersion: "1.0.0",
      minVersion: "0.10.0",
      rollout: 2500,
    };
    const parsed = parseFlagPayload(withRule(rule));
    expect(parsed.flags["swap.enabled"]).toEqual(rule);
    expect(parsed.issuedAt).toBe(NOW - 86_400_000);
  });

  test("keeps unknown-to-this-build flag keys (evaluation drops them)", () => {
    const parsed = parseFlagPayload(payload({ flags: { "future.thing": { enabled: true } } }));
    expect(Object.keys(parsed.flags)).toEqual(["future.thing"]);
  });

  test.each([
    [
      "missing sequence",
      (() => {
        const { sequence: _s, ...rest } = payload();
        return rest;
      })(),
    ],
    ["sequence 0", payload({ sequence: 0 })],
    ["negative sequence", payload({ sequence: -1 })],
    ["string sequence", payload({ sequence: "5" })],
    ["unknown channel", payload({ channel: "staging" })],
    ["unknown payload field", payload({ extra: true })],
    ["expiresAt before issuedAt", payload({ expiresAt: stamp(NOW - 2 * 86_400_000) })],
    ["validity over 90 days", payload({ expiresAt: stamp(NOW + 90 * 86_400_000) })],
    ["flags not an object", payload({ flags: [] })],
    ["invalid flag key", payload({ flags: { Swap: { enabled: true } } })],
    [
      "more than 64 flags",
      payload({
        flags: Object.fromEntries(
          Array.from({ length: 65 }, (_, i) => [`f.flag${i}`, { enabled: true }]),
        ),
      }),
    ],
    ["rule missing enabled", withRule({ rollout: 10 })],
    ["rule enabled not boolean", withRule({ enabled: "true" })],
    ["rule unknown field", withRule({ enabled: true, rpcUrl: "https://x" })],
    ["rollout over 10000", withRule({ enabled: true, rollout: 10_001 })],
    ["fractional rollout", withRule({ enabled: true, rollout: 1.5 })],
    ["bad minVersion", withRule({ enabled: true, minVersion: "1.0" })],
    ["leading-zero version", withRule({ enabled: true, maxVersion: "01.0.0" })],
    ["min above max", withRule({ enabled: true, maxVersion: "0.9.0", minVersion: "1.0.0" })],
    ["empty chains", withRule({ chains: [], enabled: true })],
    ["unknown chain", withRule({ chains: ["SN_DEVNET"], enabled: true })],
    ["duplicate chains", withRule({ chains: ["SN_MAIN", "SN_MAIN"], enabled: true })],
  ])("rejects %s", (_label, value) => {
    rejects(value);
  });
});

describe("parseFlagTimestamp", () => {
  test.each([
    "2026-02-30T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-11-16T24:00:00Z",
    "2026-11-16T12:00:00.000Z",
    "2026-11-16 12:00:00Z",
    "2026-11-16T12:00:00+00:00",
  ])("rejects %s", (value) => {
    expect(() => parseFlagTimestamp(value)).toThrow(FlagContractError);
  });

  test("accepts a leap day and matches Date.parse", () => {
    expect(parseFlagTimestamp("2028-02-29T23:59:59Z")).toBe(Date.parse("2028-02-29T23:59:59Z"));
  });
});

describe("grammar helpers", () => {
  test("flag keys follow the bramble-ff grammar and length cap", () => {
    expect(isFlagKey("swap.enabled")).toBe(true);
    expect(isFlagKey("privacy.ledger-v2")).toBe(true);
    expect(isFlagKey("swap")).toBe(false);
    expect(isFlagKey(`a.${"b".repeat(63)}`)).toBe(false);
  });

  test("versions compare numerically, not lexically", () => {
    expect(compareFlagVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareFlagVersions("1.0.0", "1.0.0")).toBe(0);
  });
});
