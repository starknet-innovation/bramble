/**
 * Cable reconnect against the real Ledger transport and connector, with fake
 * WebUSB/WebHID devices. Chromium's "already open" and a claim held by this
 * extension's own hardware tab must not be reported as another app.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { ledgerConnector } from "@bramble/ledger-browser/connector";
import { LedgerRejection } from "@bramble/ledger-protocol/errors";

const LEDGER_VID = 0x2c97;

class UsbHost {
  owner: FakeUSBDevice | null = null;
}

class FakeUSBDevice {
  readonly vendorId = LEDGER_VID;
  readonly productId = 0x4011;
  readonly productName = "Nano X";
  opened = false;
  claimed = false;
  configuration: unknown = null;
  readonly configurations = [
    { interfaces: [{ interfaceNumber: 2, alternates: [{ interfaceClass: 255 }] }] },
  ];
  constructor(readonly host: UsbHost) {}
  async open() {
    this.opened = true;
  }
  async selectConfiguration() {
    this.configuration = this.configurations[0];
  }
  async reset() {
    return undefined;
  }
  async claimInterface() {
    if (this.claimed) return;
    if (this.host.owner && this.host.owner !== this) {
      throw new DOMException("Unable to claim interface.", "NetworkError");
    }
    this.host.owner = this;
    this.claimed = true;
  }
  async releaseInterface() {
    this.claimed = false;
    if (this.host.owner === this) this.host.owner = null;
  }
  async close() {
    this.opened = false;
  }
  async transferOut() {
    if (!this.claimed) {
      throw new DOMException("The specified interface has not been claimed.", "InvalidStateError");
    }
    return { status: "ok" };
  }
  async transferIn() {
    if (!this.claimed) {
      throw new DOMException("The specified interface has not been claimed.", "InvalidStateError");
    }
    throw new Error("no APDU emulation");
  }
}

class FakeHIDDevice {
  readonly vendorId = LEDGER_VID;
  readonly productId = 0x4015;
  readonly productName = "Nano X";
  readonly collections = [{ usagePage: 0xffa0, usage: 1 }];
  opened = false;
  blocked: boolean;
  constructor(heldByOtherProcess = false) {
    this.blocked = heldByOtherProcess;
  }
  async open() {
    if (this.opened) throw new DOMException("The device is already open.", "InvalidStateError");
    if (this.blocked) {
      throw new DOMException("Failed to open the device.", "NotAllowedError");
    }
    this.opened = true;
  }
  async close() {
    this.opened = false;
  }
  addEventListener() {
    return undefined;
  }
  removeEventListener() {
    return undefined;
  }
  async sendReport() {
    return undefined;
  }
}

const nav = navigator as unknown as Record<string, unknown>;
const scope = globalThis as { browser?: unknown; chrome?: unknown; window?: unknown };
const previousWindow = scope.window;

const setNav = (key: "usb" | "hid" | "locks", value: unknown): void => {
  Object.defineProperty(nav, key, { configurable: true, value, writable: true });
};

const usbApi = (device: FakeUSBDevice) => ({
  addEventListener() {
    return undefined;
  },
  getDevices: async () => [device],
  removeEventListener() {
    return undefined;
  },
});

const hidApi = (device: FakeHIDDevice) => ({
  addEventListener() {
    return undefined;
  },
  getDevices: async () => [device],
  removeEventListener() {
    return undefined;
  },
});

const ORPHAN = "00000000-0000-4000-8000-0000000000aa";
const LIVE = "00000000-0000-4000-8000-0000000000bb";
const PREFIX = "chrome-extension://bramble/ledger-grant.html";

// Web Locks seen from the panel: only the sessions listed still have a panel.
// The grant tab is waiting shared because the panel held the lock and let it go.
const locksPanelLeft = (session: string) => ({
  query: async () => ({
    held: [],
    pending: [{ mode: "shared" as const, name: `bramble-ledger-panel:${session}` }],
  }),
  request: async () => undefined,
});

const locksHolding = (...sessions: string[]) => ({
  query: async () => ({
    held: sessions.map((id) => ({
      mode: "exclusive" as const,
      name: `bramble-ledger-panel:${id}`,
    })),
    pending: [],
  }),
  request: async () => undefined,
});

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  setNav("usb", undefined);
  setNav("hid", undefined);
  setNav("locks", undefined);
  scope.browser = undefined;
  scope.chrome = undefined;
  scope.window = previousWindow;
});

describe("cable reconnect stale handles", () => {
  test("a second open waits until the first session has closed", async () => {
    const device = new FakeHIDDevice();
    scope.window = globalThis;
    setNav("hid", hidApi(device));

    const first = await ledgerConnector.openConnected();
    expect(first).toBeTruthy();
    let secondOpened = false;
    const second = ledgerConnector.openConnected().then((session) => {
      secondOpened = true;
      return session;
    });
    await tick();
    expect(secondOpened).toBe(false);

    await first?.close();
    const opened = await second;
    expect(secondOpened).toBe(true);
    expect(device.opened).toBe(true);
    await opened?.close();
  });

  test("an already-open handle in this document is closed and retried", async () => {
    const device = new FakeHIDDevice();
    scope.window = globalThis;
    setNav("hid", hidApi(device));
    await device.open();

    const session = await ledgerConnector.openConnected();
    expect(session).toBeTruthy();
    expect(device.opened).toBe(true);
    await session?.close();
  });

  test("an orphaned tab holding WebHID is released and the open is retried", async () => {
    const device = new FakeHIDDevice(true);
    scope.window = globalThis;
    setNav("hid", hidApi(device));
    setNav("locks", locksPanelLeft(ORPHAN));
    scope.chrome = {
      runtime: {
        getContexts: async () => [{ documentUrl: `${PREFIX}#session=${ORPHAN}`, tabId: 11 }],
        getURL: (path: string) => `chrome-extension://bramble/${path}`,
      },
      tabs: {
        remove: async () => {
          device.blocked = false;
        },
      },
    };

    const session = await ledgerConnector.openConnected();
    expect(session).toBeTruthy();
    expect(device.opened).toBe(true);
    await session?.close();
  });

  test("another process holding HID is not labelled device-busy", async () => {
    scope.window = globalThis;
    setNav("hid", hidApi(new FakeHIDDevice(true)));
    const error = await ledgerConnector.openConnected().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LedgerRejection);
    expect(error).toMatchObject({
      causeName: "NotAllowedError",
      code: "unexpected-device-error",
    });
  });

  test("our orphaned hardware tab is released and the open is retried", async () => {
    const host = new UsbHost();
    const grant = new FakeUSBDevice(host);
    await grant.open();
    await grant.claimInterface();
    const panel = new FakeUSBDevice(host);
    setNav("usb", usbApi(panel));
    setNav("locks", locksPanelLeft(ORPHAN));
    scope.chrome = {
      runtime: {
        getContexts: async () => [{ documentUrl: `${PREFIX}#session=${ORPHAN}`, tabId: 7 }],
        getURL: (path: string) => `chrome-extension://bramble/${path}`,
      },
      tabs: {
        remove: async () => {
          await grant.releaseInterface();
          await grant.close();
        },
      },
    };

    const session = await ledgerConnector.openConnected();
    expect(session).toBeTruthy();
    expect(panel.claimed).toBe(true);
    expect(grant.claimed).toBe(false);
    await session?.close();
  });

  test("a claim with no hardware tab of ours stays device-busy", async () => {
    const host = new UsbHost();
    const grant = new FakeUSBDevice(host);
    await grant.open();
    await grant.claimInterface();
    setNav("usb", usbApi(new FakeUSBDevice(host)));
    let claims = 0;
    const original = FakeUSBDevice.prototype.claimInterface;
    FakeUSBDevice.prototype.claimInterface = async function claim() {
      claims += 1;
      return original.call(this);
    };

    try {
      const error = await ledgerConnector.openConnected().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(LedgerRejection);
      expect(error).toMatchObject({
        causeName: "TransportInterfaceNotAvailable",
        code: "device-busy",
      });
      // Nothing of ours was holding it. The open still waits once for a claim
      // that may already be draining, then reports the other holder.
      expect(claims).toBe(2);
    } finally {
      FakeUSBDevice.prototype.claimInterface = original;
    }
  });

  test("a grant tab waiting on its own lock is still an orphan", async () => {
    const host = new UsbHost();
    const grant = new FakeUSBDevice(host);
    await grant.open();
    await grant.claimInterface();
    const panel = new FakeUSBDevice(host);
    setNav("usb", usbApi(panel));
    setNav("locks", {
      query: async () => ({
        held: [{ mode: "shared" as const, name: `bramble-ledger-panel:${ORPHAN}` }],
        pending: [{ mode: "shared" as const, name: `bramble-ledger-panel:${ORPHAN}` }],
      }),
      request: async () => undefined,
    });
    scope.chrome = {
      runtime: {
        getContexts: async () => [{ documentUrl: `${PREFIX}#session=${ORPHAN}`, tabId: 8 }],
        getURL: (path: string) => `chrome-extension://bramble/${path}`,
      },
      tabs: {
        remove: async () => {
          await grant.releaseInterface();
          await grant.close();
        },
      },
    };

    const session = await ledgerConnector.openConnected();
    expect(session).toBeTruthy();
    expect(grant.claimed).toBe(false);
    await session?.close();
  });

  test("a grant tab with no panel lock is left alone", async () => {
    const host = new UsbHost();
    const grant = new FakeUSBDevice(host);
    await grant.open();
    await grant.claimInterface();
    setNav("usb", usbApi(new FakeUSBDevice(host)));
    setNav("locks", locksHolding());
    const removed: number[] = [];
    scope.chrome = {
      runtime: {
        getContexts: async () => [{ documentUrl: `${PREFIX}#session=${ORPHAN}`, tabId: 12 }],
        getURL: (path: string) => `chrome-extension://bramble/${path}`,
      },
      tabs: {
        remove: async (tabId: number) => {
          removed.push(tabId);
          await grant.releaseInterface();
        },
      },
    };

    const error = await ledgerConnector.openConnected().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "device-busy" });
    expect(removed).toEqual([]);
    expect(grant.claimed).toBe(true);
  });

  test("a hardware tab whose panel is still alive is not closed", async () => {
    const host = new UsbHost();
    const grant = new FakeUSBDevice(host);
    await grant.open();
    await grant.claimInterface();
    setNav("usb", usbApi(new FakeUSBDevice(host)));
    setNav("locks", locksHolding(LIVE));
    const removed: number[] = [];
    scope.chrome = {
      runtime: {
        getContexts: async () => [{ documentUrl: `${PREFIX}#session=${LIVE}`, tabId: 9 }],
        getURL: (path: string) => `chrome-extension://bramble/${path}`,
      },
      tabs: {
        remove: async (tabId: number) => {
          removed.push(tabId);
        },
      },
    };

    const error = await ledgerConnector.openConnected().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "device-busy" });
    expect(removed).toEqual([]);
    expect(grant.claimed).toBe(true);
  });

  test("a tab that fails to close does not count as released", async () => {
    const host = new UsbHost();
    const grant = new FakeUSBDevice(host);
    await grant.open();
    await grant.claimInterface();
    setNav("usb", usbApi(new FakeUSBDevice(host)));
    setNav("locks", locksPanelLeft(ORPHAN));
    let claims = 0;
    const original = FakeUSBDevice.prototype.claimInterface;
    FakeUSBDevice.prototype.claimInterface = async function claim() {
      claims += 1;
      return original.call(this);
    };
    scope.chrome = {
      runtime: {
        getContexts: async () => [{ documentUrl: `${PREFIX}#session=${ORPHAN}`, tabId: 7 }],
        getURL: (path: string) => `chrome-extension://bramble/${path}`,
      },
      tabs: {
        remove: async () => {
          throw new Error("No tab with id: 7.");
        },
      },
    };

    try {
      const error = await ledgerConnector.openConnected().catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code: "device-busy" });
      expect(claims).toBe(2);
    } finally {
      FakeUSBDevice.prototype.claimInterface = original;
    }
  });
});
