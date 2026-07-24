/**
 * Ledger rejection catalog checks: every code has user copy, wrapping is total
 * (an unknown throw becomes the default rejection), and a LedgerRejection passes
 * through unchanged so a mapped code is never re-wrapped.
 */
import { describe, expect, test } from "bun:test";
import {
  asLedgerRejection,
  LedgerRejection,
  type LedgerRejectionCode,
  ledgerMessage,
} from "../../src/sidepanel/ledger/errors";

const ALL_CODES: readonly LedgerRejectionCode[] = [
  "webhid-unavailable",
  "picker-cancelled",
  "device-locked",
  "no-app-open",
  "app-below-minimum",
  "blind-signing-disabled",
  "device-busy",
  "replug",
  "multiple-devices",
  "wrong-device",
  "network-mismatch",
  "deploy-unfunded",
  "rejected-on-device",
  "locked-mid-sign",
  "disconnected-mid-sign",
  "panel-context-lost",
  "sign-timeout",
  "signature-verify-failed",
  "worker-evicted",
  "chain-failed",
  "unexpected-device-error",
];

describe("ledger rejection catalog", () => {
  test("every code has non-empty user-facing copy", () => {
    for (const code of ALL_CODES) {
      expect(ledgerMessage(code).length).toBeGreaterThan(0);
    }
  });

  test("a LedgerRejection carries its code and optional status word", () => {
    const rejection = new LedgerRejection("app-below-minimum", 0x6d00);
    expect(rejection.code).toBe("app-below-minimum");
    expect(rejection.statusWord).toBe(0x6d00);
    expect(rejection).toBeInstanceOf(Error);
  });

  test("asLedgerRejection passes a rejection through and wraps anything else", () => {
    const original = new LedgerRejection("rejected-on-device");
    expect(asLedgerRejection(original)).toBe(original);
    expect(asLedgerRejection(new Error("boom")).code).toBe("unexpected-device-error");
    expect(asLedgerRejection("nope").code).toBe("unexpected-device-error");
  });
});
