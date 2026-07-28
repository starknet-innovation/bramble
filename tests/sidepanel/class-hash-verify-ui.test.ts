/**
 * UI boundary for on-chain class-hash verification: the response parser rejects
 * malformed payloads (so a corrupt shape can never read as "verified"), and the
 * account-screen badge renders each verdict distinctly — a mismatch as an
 * assertive alert with the offending on-chain hash escaped.
 */
import { describe, expect, test } from "bun:test";
import { isClassHashVerificationResponse } from "../../src/popup/responses";
import { classHashVerificationBadge } from "../../src/sidepanel/flows";

const ACCOUNT_ID = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const ON_CHAIN = "0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3";

describe("isClassHashVerificationResponse", () => {
  test("accepts each valid verdict", () => {
    for (const verification of [
      { onChainClassHash: ON_CHAIN, status: "verified" },
      { expectedClassHash: "0x1", onChainClassHash: ON_CHAIN, status: "mismatch" },
      { status: "undeployed" },
      { status: "unreachable" },
    ]) {
      expect(
        isClassHashVerificationResponse({ accountId: ACCOUNT_ID, ok: true, verification }),
      ).toBe(true);
    }
  });

  test("rejects an unknown status", () => {
    expect(
      isClassHashVerificationResponse({
        accountId: ACCOUNT_ID,
        ok: true,
        verification: { status: "trusted" },
      }),
    ).toBe(false);
  });

  test("rejects a verified verdict missing its on-chain hash", () => {
    expect(
      isClassHashVerificationResponse({
        accountId: ACCOUNT_ID,
        ok: true,
        verification: { status: "verified" },
      }),
    ).toBe(false);
  });

  test("rejects a verified verdict whose hash is not a felt", () => {
    expect(
      isClassHashVerificationResponse({
        accountId: ACCOUNT_ID,
        ok: true,
        verification: { onChainClassHash: "nope", status: "verified" },
      }),
    ).toBe(false);
  });

  test("rejects a verified verdict whose on-chain hash is zero or negative", () => {
    // A zero on-chain hash means no contract (an undeployed account); the domain
    // never emits `verified` with one. The parser must not let such a payload
    // render as "Verified on-chain" — the exact false positive it guards against.
    for (const onChainClassHash of ["0x0", "0x00", "0", "-0x1"]) {
      expect(
        isClassHashVerificationResponse({
          accountId: ACCOUNT_ID,
          ok: true,
          verification: { onChainClassHash, status: "verified" },
        }),
      ).toBe(false);
    }
  });

  test("rejects a mismatch verdict carrying a zero expected or on-chain hash", () => {
    for (const verification of [
      { expectedClassHash: "0x0", onChainClassHash: ON_CHAIN, status: "mismatch" },
      { expectedClassHash: "0x1", onChainClassHash: "0x0", status: "mismatch" },
    ]) {
      expect(
        isClassHashVerificationResponse({ accountId: ACCOUNT_ID, ok: true, verification }),
      ).toBe(false);
    }
  });

  test("rejects a non-ok or unknown-account payload", () => {
    expect(isClassHashVerificationResponse({ ok: false })).toBe(false);
    expect(
      isClassHashVerificationResponse({
        accountId: "not-an-id",
        ok: true,
        verification: { status: "undeployed" },
      }),
    ).toBe(false);
  });
});

describe("classHashVerificationBadge", () => {
  test("shows a distinct pending state while loading (null)", () => {
    const html = classHashVerificationBadge(null);
    expect(html).toContain("verify-status pending");
    expect(html).toContain("Verifying on-chain");
    expect(html).not.toContain("Verified on-chain");
  });

  test("marks a verified account with the positive status", () => {
    const html = classHashVerificationBadge({ onChainClassHash: ON_CHAIN, status: "verified" });
    expect(html).toContain("verify-status verified");
    expect(html).toContain("Verified on-chain");
  });

  test("surfaces a mismatch as an assertive alert carrying the on-chain hash", () => {
    const html = classHashVerificationBadge({
      expectedClassHash: "0x1",
      onChainClassHash: ON_CHAIN,
      status: "mismatch",
    });
    expect(html).toContain("verify-status mismatch");
    expect(html).toContain('role="alert"');
    expect(html).toContain(ON_CHAIN);
    expect(html).toContain("Do not trust this account");
  });

  test("escapes a hostile on-chain hash rather than emitting raw markup", () => {
    const html = classHashVerificationBadge({
      expectedClassHash: "0x1",
      onChainClassHash: "<img src=x onerror=alert(1)>",
      status: "mismatch",
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  test("distinguishes undeployed and unreachable from a verified result", () => {
    for (const status of ["undeployed", "unreachable"] as const) {
      const html = classHashVerificationBadge({ status });
      expect(html).toContain("verify-status pending");
      expect(html).not.toContain("Verified on-chain");
    }
  });
});
