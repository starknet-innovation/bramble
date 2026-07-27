/**
 * Browser hardware choosers must be called synchronously from the Connect
 * click. These tests hold the picker promise open and assert the request was
 * issued before the transport function yielded to an asynchronous preflight.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { requestTransportRaw } from "../../src/sidepanel/ledger/webhid-impl";

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
