/**
 * Browser hardware choosers must be called synchronously from the Connect
 * click. These tests hold the picker promise open and assert the request was
 * issued before the transport function yielded to an asynchronous preflight.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { newStarknetClient, requestTransportRaw } from "../../src/sidepanel/ledger/webhid-impl";

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

  test("requests only Ledger APDU HID before yielding", async () => {
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
    expect(requestOptions).toEqual({
      filters: [{ usagePage: 0xffa0, vendorId: 0x2c97 }],
    });

    const failure = new DOMException("No device selected", "NotFoundError");
    rejectPicker?.(failure);
    await expect(pending).rejects.toBe(failure);
  });
});

describe("Ledger OS preflight transport transition", () => {
  test("reads firmware from the dashboard, then reopens Starknet before app checks", async () => {
    const calls: { cla: number; data: readonly number[]; ins: number }[] = [];
    const responses = [
      Buffer.from([0x90, 0x00]),
      Buffer.from([0x33, 0x00, 0x00, 0x04, 0x05, 0x32, 0x2e, 0x36, 0x2e, 0x31, 0x00, 0x90, 0x00]),
      Buffer.from([0x90, 0x00]),
      Buffer.from([0x02, 0x04, 0x00, 0x90, 0x00]),
    ];
    const transport = {
      send: async (cla: number, ins: number, _p1: number, _p2: number, data: Uint8Array) => {
        calls.push({ cla, data: [...data], ins });
        const response = responses.shift();
        if (!response) {
          throw new Error("unexpected APDU");
        }
        return response;
      },
    };
    const client = newStarknetClient(transport as never);

    await expect(client.getOsVersion()).resolves.toEqual({
      targetId: 0x33000004,
      version: "2.6.1",
    });
    await expect(client.getAppVersion()).resolves.toMatchObject({
      major: 2,
      minor: 4,
      patch: 0,
      returnCode: 0x9000,
    });
    expect(calls).toEqual([
      { cla: 0xb0, data: [], ins: 0xa7 },
      { cla: 0xe0, data: [], ins: 0x01 },
      { cla: 0xe0, data: [...Buffer.from("Starknet", "ascii")], ins: 0xd8 },
      { cla: 0x5a, data: [], ins: 0x00 },
    ]);
  });

  test("restores Starknet after rejecting a truncated OS response", async () => {
    const calls: { cla: number; data: readonly number[]; ins: number }[] = [];
    const responses = [
      Buffer.from([0x90, 0x00]),
      Buffer.from([0x33, 0x00, 0x00, 0x04, 0x05, 0x32, 0x2e, 0x36, 0x2e, 0x31, 0x90, 0x00]),
      Buffer.from([0x90, 0x00]),
    ];
    const transport = {
      send: async (cla: number, ins: number, _p1: number, _p2: number, data: Uint8Array) => {
        calls.push({ cla, data: [...data], ins });
        const response = responses.shift();
        if (!response) {
          throw new Error("unexpected APDU");
        }
        return response;
      },
    };

    await expect(newStarknetClient(transport as never).getOsVersion()).rejects.toThrow(
      "Malformed Ledger OS version response",
    );
    expect(calls).toEqual([
      { cla: 0xb0, data: [], ins: 0xa7 },
      { cla: 0xe0, data: [], ins: 0x01 },
      { cla: 0xe0, data: [...Buffer.from("Starknet", "ascii")], ins: 0xd8 },
    ]);
  });
});
