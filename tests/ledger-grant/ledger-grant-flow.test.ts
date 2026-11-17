/**
 * Ledger grant policy tests: cable is the device-neutral default, compatibility
 * transports cycle deterministically, and raw browser errors are reduced to
 * fixed support-safe categories.
 */
import { describe, expect, test } from "bun:test";
import {
  alternateLedgerTransport,
  ledgerGrantDiagnostic,
  ledgerGrantFailure,
  preferredLedgerTransport,
  transportForConnectionMethod,
} from "../../apps/extension/src/ledger-grant/grant-flow";

const namedError = (name: string, message = ""): Error => {
  const error = new Error(message);
  error.name = name;
  return error;
};

describe("Ledger grant transport selection", () => {
  test("prefers WebUSB, then WebHID, then Bluetooth", () => {
    expect(preferredLedgerTransport(["usb", "hid", "ble"])).toBe("usb");
    expect(preferredLedgerTransport(["usb", "hid"])).toBe("usb");
    expect(preferredLedgerTransport(["usb"])).toBe("usb");
    expect(preferredLedgerTransport(["hid"])).toBe("hid");
    expect(preferredLedgerTransport(["ble"])).toBe("ble");
    expect(preferredLedgerTransport([])).toBeNull();
  });

  test("cycles only through supported alternate transports", () => {
    expect(alternateLedgerTransport("ble", ["ble", "usb", "hid"])).toBe("usb");
    expect(alternateLedgerTransport("usb", ["ble", "usb", "hid"])).toBe("hid");
    expect(alternateLedgerTransport("hid", ["ble", "usb", "hid"])).toBe("ble");
    expect(alternateLedgerTransport("usb", ["usb", "hid"])).toBe("hid");
    expect(alternateLedgerTransport("usb", ["usb"])).toBeNull();
  });

  test("honors the explicit cable or Bluetooth method without crossing between them", () => {
    const supported = ["ble", "usb", "hid"] as const;
    expect(transportForConnectionMethod("cable", supported, null)).toBe("usb");
    expect(transportForConnectionMethod("cable", supported, "hid")).toBe("hid");
    expect(transportForConnectionMethod("cable", supported, "ble")).toBe("usb");
    expect(transportForConnectionMethod("ble", supported, null)).toBe("ble");
    expect(transportForConnectionMethod("ble", supported, "usb")).toBe("ble");
    expect(transportForConnectionMethod("ble", ["usb", "hid"], null)).toBeNull();
  });
});

describe("ledgerGrantFailure", () => {
  test("distinguishes picker, policy, interface, support, and unexpected failures", () => {
    expect(ledgerGrantFailure(new DOMException("closed", "NotFoundError"))).toBe(
      "permission-dismissed",
    );
    expect(ledgerGrantFailure(namedError("TransportOpenUserCancelled"))).toBe(
      "permission-dismissed",
    );
    expect(ledgerGrantFailure(new DOMException("blocked", "SecurityError"))).toBe(
      "permission-blocked",
    );
    expect(ledgerGrantFailure(namedError("TransportInterfaceNotAvailable"))).toBe(
      "interface-unavailable",
    );
    expect(ledgerGrantFailure(new Error("Unable to claim interface"))).toBe(
      "interface-unavailable",
    );
    expect(ledgerGrantFailure(namedError("TransportNotSupported"))).toBe("transport-unavailable");
    expect(ledgerGrantFailure(new Error("device failed"))).toBe("unexpected");
    expect(ledgerGrantFailure("unknown")).toBe("unexpected");
  });
});

describe("ledgerGrantDiagnostic", () => {
  test("reports only fixed browser capability and saved-grant state", () => {
    expect(
      ledgerGrantDiagnostic("BRAMBLE-LDG-USB-PICKER", {
        apiAvailable: true,
        grantedDeviceCount: 0,
      }),
    ).toBe("Support code · BRAMBLE-LDG-USB-PICKER · API ready · saved grants 0");
    expect(
      ledgerGrantDiagnostic("BRAMBLE-LDG-BLE-PICKER", {
        apiAvailable: false,
        grantedDeviceCount: null,
      }),
    ).toBe("Support code · BRAMBLE-LDG-BLE-PICKER · API unavailable · saved grants unavailable");
  });
});
