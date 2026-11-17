/**
 * Browser hardware choosers must be called synchronously from the Connect
 * click. These tests hold the picker promise open and assert the request was
 * issued before the transport function yielded to an asynchronous preflight.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  bindLedgerTransportRaw,
  type LedgerRawTransport,
  newStarknetClient,
  requestTransportRaw,
} from "@bramble/ledger-browser/webhid";
import { ledgerAppStateResponse, ledgerNanoXOsResponse } from "@bramble/testkit/ledger-management";

type UsbPickerOptions = {
  readonly filters: readonly { readonly classCode?: number; readonly vendorId?: number }[];
};

type HidPickerOptions = {
  readonly filters: readonly {
    readonly usagePage?: number;
    readonly vendorId?: number;
  }[];
};

const originalUsb = Object.getOwnPropertyDescriptor(navigator, "usb");
const originalHid = Object.getOwnPropertyDescriptor(navigator, "hid");

const restoreNavigatorProperty = (
  key: "hid" | "usb",
  descriptor: PropertyDescriptor | undefined,
): void => {
  if (descriptor) {
    Object.defineProperty(navigator, key, descriptor);
    return;
  }
  Reflect.deleteProperty(navigator, key);
};

afterEach(() => {
  restoreNavigatorProperty("usb", originalUsb);
  restoreNavigatorProperty("hid", originalHid);
});

describe("Ledger browser chooser activation", () => {
  test("requests the Ledger vendor WebUSB interface before yielding", async () => {
    let rejectPicker: ((reason: unknown) => void) | undefined;
    const picker = new Promise<never>((_resolve, reject) => {
      rejectPicker = reject;
    });
    let requestOptions: UsbPickerOptions | undefined;
    Object.defineProperty(navigator, "usb", {
      configurable: true,
      value: {
        requestDevice: (options: UsbPickerOptions): Promise<never> => {
          requestOptions = options;
          return picker;
        },
      },
    });

    const pending = requestTransportRaw("usb");
    expect(requestOptions).toEqual({
      filters: [{ classCode: 0xff, vendorId: 0x2c97 }],
    });

    const failure = new DOMException("No device selected", "NotFoundError");
    rejectPicker?.(failure);
    await expect(pending).rejects.toBe(failure);
  });

  test("offers every Ledger by vendor id, so an open app cannot hide the device", async () => {
    let rejectPicker: ((reason: unknown) => void) | undefined;
    const picker = new Promise<never>((_resolve, reject) => {
      rejectPicker = reject;
    });
    let requestOptions: HidPickerOptions | undefined;
    Object.defineProperty(navigator, "hid", {
      configurable: true,
      value: {
        requestDevice: (options: HidPickerOptions): Promise<never> => {
          requestOptions = options;
          return picker;
        },
      },
    });

    const pending = requestTransportRaw("hid");
    // Vendor id ONLY. Filtering the picker by the APDU usage page made a Ledger
    // with the Starknet app open invisible, while the same device appeared from
    // the dashboard; the APDU collection is preferred after selection instead.
    expect(requestOptions).toEqual({
      filters: [{ vendorId: 0x2c97 }],
    });

    const failure = new DOMException("No device selected", "NotFoundError");
    rejectPicker?.(failure);
    await expect(pending).rejects.toBe(failure);
  });
});

describe("Ledger OS preflight transport transition", () => {
  test("releases both binding and current transport exactly once", async () => {
    let disconnects = 0;
    let closes = 0;
    const transport = bindLedgerTransportRaw(
      {
        close: async () => {
          closes += 1;
        },
        send: async () => Buffer.from([0x90, 0x00]),
      },
      {
        disconnect: async () => {
          disconnects += 1;
        },
        listDevices: async () => [],
        openDevice: async () => {
          throw new Error("not used");
        },
        selectedDevice: {},
      },
    );

    await transport.close();
    await transport.close();
    expect({ closes, disconnects }).toEqual({ closes: 1, disconnects: 1 });
  });

  test("the client continues on the exact transport reopened by its binding", async () => {
    const calls: { cla: number; data: readonly number[]; ins: number }[] = [];
    const initialResponses = [
      ledgerAppStateResponse("BOLOS", "1.0.0"),
      ledgerNanoXOsResponse(),
      Buffer.from([0x90, 0x00]),
    ];
    const reopenedResponses = [
      ledgerAppStateResponse("Starknet"),
      Buffer.from([0x02, 0x04, 0x00, 0x90, 0x00]),
    ];
    const rawTransport = (responses: Uint8Array[]): LedgerRawTransport => ({
      close: async () => undefined,
      send: async (cla: number, ins: number, _p1: number, _p2: number, data: Uint8Array) => {
        calls.push({ cla, data: [...data], ins });
        const response = responses.shift();
        if (!response) {
          throw new Error("unexpected APDU");
        }
        return response;
      },
    });
    const selectedDevice = { id: "selected-ledger" };
    const transport = bindLedgerTransportRaw(rawTransport(initialResponses), {
      listDevices: async () => [selectedDevice],
      openDevice: async () => rawTransport(reopenedResponses),
      selectedDevice,
    });
    const client = newStarknetClient(transport);

    await expect(client.getOsVersion()).resolves.toEqual({
      targetId: 0x33000004,
      version: "2.2.3",
    });
    await expect(client.getAppVersion()).resolves.toMatchObject({
      major: 2,
      minor: 4,
      patch: 0,
      returnCode: 0x9000,
    });
    expect(calls).toEqual([
      { cla: 0xb0, data: [], ins: 0x01 },
      { cla: 0xe0, data: [], ins: 0x01 },
      { cla: 0xe0, data: [...Buffer.from("Starknet", "ascii")], ins: 0xd8 },
      { cla: 0xb0, data: [], ins: 0x01 },
      { cla: 0x5a, data: [], ins: 0x00 },
    ]);
  });
});
