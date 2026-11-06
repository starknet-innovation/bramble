/**
 * Page-side half of the Playwright-only Ledger bridge: a fake `navigator.hid`
 * exposing one Ledger with the vendor-defined APDU collection (usage page
 * `0xFFA0`). It is serialised into every page of the browser context by
 * `context.addInitScript`, so it is present in the side panel and in any
 * extension tab or window opened later (the Ledger grant tab included).
 *
 * The fake holds no protocol logic. Every output report is handed to Node
 * through the `exposeBinding` named in the config; Node reassembles the APDU,
 * answers it (Speculos or the dashboard stand-in) and returns the framed input
 * reports, plus a flag when the device drops off the bus.
 *
 * WebUSB is hidden in the same pages: the wallet tries USB before HID, and
 * Chromium's real WebUSB would otherwise answer with an empty device list or a
 * chooser no test can drive. The USB-only paths are therefore not exercised.
 *
 * Not exercised: Chrome's real device chooser and its user-activation rule
 * (`requestDevice` grants at once), and real reconnect identity — the fake
 * hands back the same device object after a transition.
 *
 * Test-only. Nothing in `apps/` or `packages/` may import this file.
 */

/** Values the Node half passes into the serialised page script. */
export type FakeLedgerHidConfig = {
  readonly binding: string;
  readonly productId: number;
  readonly productName: string;
  readonly reconnectMs: number;
  readonly usagePage: number;
  readonly vendorId: number;
};

/** Messages the page sends to Node through the binding. */
export type HidBridgeRequest =
  | { readonly op: "getDevices" }
  | { readonly op: "requestDevice"; readonly vendorIds: readonly number[] }
  | { readonly op: "report"; readonly packet: readonly number[] };

/** Node's answer to one {@link HidBridgeRequest}. */
export type HidBridgeReply = {
  readonly disconnect?: boolean;
  readonly packets?: readonly (readonly number[])[];
  readonly present?: boolean;
};

/**
 * Replaces `navigator.hid` in the current page. Runs inside the browser, so it
 * must stay self-contained: no imports, no closures over module scope.
 */
export const installFakeLedgerHid = (config: FakeLedgerHidConfig): void => {
  const bridge = (request: HidBridgeRequest): Promise<HidBridgeReply> => {
    const binding = (window as unknown as Record<string, unknown>)[config.binding];
    if (typeof binding !== "function") {
      return Promise.reject(new DOMException("Ledger bridge binding missing", "NotFoundError"));
    }
    return (binding as (value: HidBridgeRequest) => Promise<HidBridgeReply>)(request);
  };

  const hid = new EventTarget();
  const withDevice = (type: string, device: EventTarget): Event => {
    const event = new Event(type);
    Object.defineProperty(event, "device", { value: device });
    return event;
  };

  class FakeLedgerHidDevice extends EventTarget {
    readonly collections = [
      {
        children: [],
        featureReports: [],
        inputReports: [],
        outputReports: [],
        type: 1,
        usage: 1,
        usagePage: config.usagePage,
      },
    ];
    opened = false;
    oninputreport: ((event: Event) => void) | null = null;
    readonly productId = config.productId;
    readonly productName = config.productName;
    readonly vendorId = config.vendorId;

    async open(): Promise<void> {
      if (!(await bridge({ op: "getDevices" })).present) {
        throw new DOMException("Failed to open the device.", "NetworkError");
      }
      this.opened = true;
    }

    async close(): Promise<void> {
      this.opened = false;
    }

    async forget(): Promise<void> {
      this.opened = false;
    }

    async sendReport(reportId: number, data: BufferSource): Promise<void> {
      if (!this.opened || reportId !== 0) {
        throw new DOMException("Failed to write the report.", "NotAllowedError");
      }
      const view =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const reply = await bridge({ op: "report", packet: Array.from(view) });
      // Input reports arrive after the write resolves, as on hardware.
      setTimeout(() => {
        for (const packet of reply.packets ?? []) {
          const event = new Event("inputreport");
          Object.defineProperties(event, {
            data: { value: new DataView(Uint8Array.from(packet).buffer) },
            device: { value: this },
            reportId: { value: 0 },
          });
          this.dispatchEvent(event);
          this.oninputreport?.(event);
        }
        if (reply.disconnect) {
          this.opened = false;
          hid.dispatchEvent(withDevice("disconnect", this));
          setTimeout(() => hid.dispatchEvent(withDevice("connect", this)), config.reconnectMs);
        }
      }, 0);
    }
  }

  const device = new FakeLedgerHidDevice();
  const fakeHid = Object.assign(hid, {
    getDevices: async (): Promise<FakeLedgerHidDevice[]> =>
      (await bridge({ op: "getDevices" })).present ? [device] : [],
    onconnect: null,
    ondisconnect: null,
    requestDevice: async (options?: {
      readonly filters?: readonly { readonly vendorId?: number }[];
    }): Promise<FakeLedgerHidDevice[]> => {
      const vendorIds = (options?.filters ?? []).flatMap((filter) =>
        typeof filter.vendorId === "number" ? [filter.vendorId] : [],
      );
      return (await bridge({ op: "requestDevice", vendorIds })).present ? [device] : [];
    },
  });
  Object.defineProperty(Navigator.prototype, "usb", {
    configurable: true,
    get: () => undefined,
  });
  Object.defineProperty(Navigator.prototype, "hid", {
    configurable: true,
    get: () => fakeHid,
  });
};
