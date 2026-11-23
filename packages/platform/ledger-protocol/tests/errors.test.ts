/**
 * Ledger rejection catalog checks: every code has user copy, wrapping is total
 * (an unknown throw becomes the default rejection), and a LedgerRejection passes
 * through unchanged so a mapped code is never re-wrapped.
 */
import { describe, expect, test } from "bun:test";
import {
  asLedgerRejection,
  isLedgerCauseToken,
  LedgerRejection,
  type LedgerRejectionCode,
  ledgerErrorSupportCode,
  ledgerMessage,
} from "@bramble/ledger-protocol/errors";

const ALL_CODES: readonly LedgerRejectionCode[] = [
  "webhid-unavailable",
  "picker-cancelled",
  "device-locked",
  "no-app-open",
  "app-below-minimum",
  "firmware-below-minimum",
  "rejected-or-blind-signing-off",
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
  "unsupported-ledger-device",
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

  test("device-busy and the generic error say what to do and do not name Ledger Live", () => {
    expect(ledgerMessage("device-busy")).toBe(
      "Something else is using your Ledger. Close other wallet apps and Bramble windows, unplug and replug it, then try again.",
    );
    expect(ledgerMessage("unexpected-device-error")).toBe(
      "Something went wrong talking to your Ledger. Unlock it, open the Starknet app, close other wallets and Bramble windows, then unplug it and try again.",
    );
    expect(ledgerMessage("device-busy")).not.toContain("Ledger Live");
    expect(ledgerMessage("unexpected-device-error")).not.toContain("Ledger Live");
  });

  test("a support line keeps a class name and drops a message", () => {
    const named = new LedgerRejection("unexpected-device-error", undefined, {
      causeName: "InvalidStateError",
    });
    expect(ledgerErrorSupportCode(named)).toBe(
      "Support code · unexpected-device-error · InvalidStateError",
    );
    expect(ledgerErrorSupportCode(new LedgerRejection("device-busy"))).toBe(
      "Support code · device-busy",
    );
    expect(ledgerErrorSupportCode(new LedgerRejection("device-locked"))).toBeUndefined();
    const raw = new Error("secret detail");
    raw.name = "NotAllowedError";
    expect(asLedgerRejection(raw).causeName).toBe("NotAllowedError");
    expect(asLedgerRejection(raw).message).toBe("unexpected-device-error");
    expect(isLedgerCauseToken("Unable to claim interface.")).toBe(false);
    expect(isLedgerCauseToken("Error")).toBe(false);
  });
});
