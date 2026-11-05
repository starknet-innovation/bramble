/**
 * The sign-in challenge is signed only when it is exactly the coordinator's
 * session-only message for this origin and address, and it expires after
 * now and within the five minutes a challenge lives. ISO instants round-trip
 * exactly and refuse every other spelling. Session tokens live an hour less
 * a minute from their sign-in, per account and address.
 */
import { describe, expect, test } from "bun:test";
import {
  QSB_CHALLENGE_CLOCK_SKEW_MS,
  QSB_CHALLENGE_LIFETIME_MS,
  qsbChallengeRefusal,
} from "@bramble/qsb/challenge";
import { isoInstant, parseIsoInstant } from "@bramble/qsb/instant";
import { createQsbSessions } from "@bramble/qsb/sessions";
import { OWNER } from "./fixtures";

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);

const challenge = (overrides: { address?: string; expires?: string; origin?: string } = {}) =>
  [
    "QSB Vault sign-in",
    `Origin: ${overrides.origin ?? "https://d1pjwwq89sze3g.cloudfront.net"}`,
    `Address: ${overrides.address ?? OWNER.address}`,
    "Network: bitcoin-mainnet",
    "Nonce: 3f1c2b9e-4d5a-4b6c-8d7e-9f0a1b2c3d4e",
    `Expires: ${overrides.expires ?? isoInstant(NOW + 300_000)}`,
    "This signature authorizes this session only. It does not authorize a Bitcoin transaction.",
  ].join("\n");

describe("ISO instants", () => {
  test.each([
    [0, "1970-01-01T00:00:00.000Z"],
    [NOW, "2026-11-04T12:00:00.000Z"],
    [Date.UTC(2024, 1, 29, 23, 59, 59, 999), "2024-02-29T23:59:59.999Z"],
    [Date.UTC(2000, 2, 1), "2000-03-01T00:00:00.000Z"],
    [Date.UTC(1969, 11, 31, 23, 59, 59), "1969-12-31T23:59:59.000Z"],
  ])("formats %p as JavaScript's toISOString does", (ms, iso) => {
    expect(isoInstant(ms)).toBe(iso);
    expect(new Date(ms).toISOString()).toBe(iso);
    expect(parseIsoInstant(iso)).toBe(ms);
  });

  test("parses whole seconds without milliseconds", () => {
    expect(parseIsoInstant("2026-11-04T12:00:00Z")).toBe(NOW);
  });

  test.each([
    "2026-11-04T12:00:00.000+00:00",
    "2026-11-04 12:00:00Z",
    "2026-02-30T00:00:00.000Z",
    "2025-02-29T00:00:00.000Z",
    "2026-13-01T00:00:00.000Z",
    "2026-11-04T24:00:00.000Z",
    "2026-11-04T12:60:00.000Z",
    "2026-11-04T12:00:00.0Z",
    "",
  ])("refuses %p", (text) => {
    expect(parseIsoInstant(text)).toBeNull();
  });

  test("refuses a clock reading it cannot format", () => {
    expect(() => isoInstant(1.5)).toThrow(RangeError);
    expect(() => isoInstant(Date.UTC(10_000, 0, 1))).toThrow(RangeError);
  });
});

describe("the sign-in challenge", () => {
  test("accepts the session-only message expiring within five minutes", () => {
    expect(qsbChallengeRefusal(challenge(), OWNER.address, NOW)).toBeNull();
    expect(
      qsbChallengeRefusal(challenge({ expires: isoInstant(NOW + 1) }), OWNER.address, NOW),
    ).toBeNull();
  });

  test.each([
    ["another origin", challenge({ origin: "https://evil.example" })],
    ["another address", challenge({ address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh" })],
    ["a trailing newline", `${challenge()}\n`],
    ["a spend authorization", challenge().replace("does not authorize", "authorizes")],
    ["testnet", challenge().replace("bitcoin-mainnet", "bitcoin-testnet")],
    ["an unreadable expiry", challenge({ expires: "soon" })],
    ["a non-string", 42],
  ])("refuses %s as shape", (_label, message) => {
    expect(qsbChallengeRefusal(message, OWNER.address, NOW)).toBe("shape");
  });

  test("escapes the address, so a pattern in it matches nothing else", () => {
    expect(qsbChallengeRefusal(challenge({ address: "bc1q.*" }), "bc1q.*", NOW)).toBeNull();
    expect(qsbChallengeRefusal(challenge({ address: "bc1qX" }), "bc1q.", NOW)).toBe("shape");
  });

  test("allows two minutes of clock skew either way, and no more, at both edges", () => {
    const at = (offset: number) =>
      qsbChallengeRefusal(challenge({ expires: isoInstant(NOW + offset) }), OWNER.address, NOW);
    expect(QSB_CHALLENGE_CLOCK_SKEW_MS).toBe(120_000);
    // This device runs fast: a fresh challenge already reads as expired, by up to the skew.
    expect(at(0)).toBeNull();
    expect(at(-QSB_CHALLENGE_CLOCK_SKEW_MS + 1)).toBeNull();
    expect(at(-QSB_CHALLENGE_CLOCK_SKEW_MS)).toBe("expired");
    // This device runs slow: a fresh challenge reads as up to the skew too far ahead.
    expect(at(QSB_CHALLENGE_LIFETIME_MS + QSB_CHALLENGE_CLOCK_SKEW_MS)).toBeNull();
    expect(at(QSB_CHALLENGE_LIFETIME_MS + QSB_CHALLENGE_CLOCK_SKEW_MS + 1)).toBe("too-far");
  });
});

describe("coordinator sessions", () => {
  test("hold a token for its address for an hour less a minute", () => {
    let now = NOW;
    const sessions = createQsbSessions({ now: () => now });
    sessions.remember("qsb-1", OWNER.address, "t".repeat(43), NOW);
    expect(sessions.token("qsb-1", OWNER.address)).toBe("t".repeat(43));
    expect(sessions.token("qsb-2", OWNER.address)).toBeNull();
    now = NOW + 3_540_000 - 1;
    expect(sessions.token("qsb-1", OWNER.address)).toBe("t".repeat(43));
    now = NOW + 3_540_000;
    expect(sessions.token("qsb-1", OWNER.address)).toBeNull();
  });

  test("never serve one address's token for another, and drop on forget and clear", () => {
    const sessions = createQsbSessions({ now: () => NOW });
    sessions.remember("qsb-1", OWNER.address, "a".repeat(43), NOW);
    expect(sessions.token("qsb-1", "bc1qother")).toBeNull();
    expect(sessions.token("qsb-1", OWNER.address)).toBeNull();
    sessions.remember("qsb-1", OWNER.address, "b".repeat(43), NOW);
    sessions.forget("qsb-1");
    expect(sessions.token("qsb-1", OWNER.address)).toBeNull();
    sessions.remember("qsb-1", OWNER.address, "c".repeat(43), NOW);
    sessions.remember("qsb-2", OWNER.address, "d".repeat(43), NOW);
    sessions.clear();
    expect(sessions.token("qsb-1", OWNER.address)).toBeNull();
    expect(sessions.token("qsb-2", OWNER.address)).toBeNull();
  });
});
