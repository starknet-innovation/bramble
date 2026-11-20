/**
 * Transport-error classification. The patterns are Chromium's and Ledger's own
 * strings: only a failed interface claim is another holder. A stale handle in
 * this page is retried, not described as another app.
 */
import { describe, expect, test } from "bun:test";
import { LedgerRejection } from "@bramble/ledger-protocol/errors";
import {
  classifyLedgerTransportError,
  ledgerTransportRejection,
} from "@bramble/ledger-protocol/transport-error";

const named = (name: string, message: string): Error => {
  const error = new Error(message);
  error.name = name;
  return error;
};

describe("classifyLedgerTransportError", () => {
  test("only a failed claim is another holder", () => {
    const claim = new DOMException("Unable to claim interface.", "NetworkError");
    expect(classifyLedgerTransportError(claim)).toMatchObject({
      causeName: "NetworkError",
      code: "device-busy",
      ownStale: false,
    });
    const wrapped = named("TransportInterfaceNotAvailable", "Unable to claim interface.");
    expect(classifyLedgerTransportError(wrapped).code).toBe("device-busy");
    expect(classifyLedgerTransportError(wrapped).ownStale).toBe(false);
  });

  test("this page's own stale handle is not device-busy", () => {
    const cases: readonly [string, Error][] = [
      ["already open", new DOMException("The device is already open.", "InvalidStateError")],
      [
        "released claim",
        new DOMException("The specified interface has not been claimed.", "InvalidStateError"),
      ],
      [
        "state change",
        new DOMException(
          "An operation that changes the device state is in progress.",
          "InvalidStateError",
        ),
      ],
      [
        "pending action",
        named(
          "TransportRaceCondition",
          "An action was already pending on the Ledger device. Please deny or reconnect.",
        ),
      ],
      ["exchange lock", named("TransportError", "Ledger Device is busy (lock getAppVersion)")],
    ];
    for (const [, error] of cases) {
      const failure = classifyLedgerTransportError(error);
      expect(failure.code).toBe("replug");
      expect(failure.ownStale).toBe(true);
      expect(failure.code).not.toBe("device-busy");
    }
  });

  test("a real HID open failure stays the generic error", () => {
    const error = new DOMException("Failed to open the device.", "NotAllowedError");
    expect(classifyLedgerTransportError(error)).toMatchObject({
      causeName: "NotAllowedError",
      code: "unexpected-device-error",
      ownStale: false,
    });
  });

  test("locked and disconnected devices keep their catalog codes", () => {
    expect(classifyLedgerTransportError(named("LockedDeviceError", "Locked device")).code).toBe(
      "device-locked",
    );
    expect(
      classifyLedgerTransportError(named("DisconnectedDevice", "The device was disconnected."))
        .code,
    ).toBe("disconnected-mid-sign");
  });

  test("a rejection keeps its cause and does not carry the message", () => {
    const error = named("InvalidStateError", "The device is already open. serial 9f3a");
    const rejection = ledgerTransportRejection(error);
    expect(rejection).toBeInstanceOf(LedgerRejection);
    expect(rejection.causeName).toBe("InvalidStateError");
    expect(rejection.ownStale).toBe(true);
    expect(rejection.message).toBe("replug");
    expect(rejection.message).not.toContain("9f3a");
  });
});
