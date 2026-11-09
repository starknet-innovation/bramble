/**
 * Runs the serialised page shim (`installFakeLedgerHid`) against the real Node
 * bridge, wired the way `LedgerHidBridge.install` wires a browser context, so
 * the page half is covered without a browser: grant, open, a framed `B0 A7`
 * answered by the dashboard stand-in, the disconnect and reconnect, and a write
 * to a closed device.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import type { BrowserContext } from "@playwright/test";
import { LedgerHidBridge } from "./hid-bridge";
import type { FakeLedgerHidConfig } from "./hid-shim";

const require = createRequire(import.meta.url);
const hostFraming: typeof import("@ledgerhq/hw-transport-webhid/hid-framing").default =
  require("@ledgerhq/hw-transport-webhid/hid-framing").default;

type PageDevice = EventTarget & {
  readonly collections: readonly { readonly usagePage: number }[];
  readonly open: () => Promise<void>;
  readonly opened: boolean;
  readonly productName: string;
  readonly sendReport: (reportId: number, data: BufferSource) => Promise<void>;
  readonly vendorId: number;
};
type PageHid = EventTarget & {
  readonly getDevices: () => Promise<PageDevice[]>;
  readonly requestDevice: (options: unknown) => Promise<PageDevice[]>;
};

const globals = globalThis as unknown as Record<string, unknown>;
const saved = {
  Navigator: globals["Navigator"],
  navigator: globals["navigator"],
  window: globals["window"],
};
// Restore every global the shim needs, so later test files in this process
// see no browser that is not there.
afterEach(() => {
  for (const name of ["Navigator", "window", "__brambleLedgerHidBridge"] as const) {
    const value = saved[name as keyof typeof saved];
    if (value === undefined) {
      delete globals[name];
    } else {
      globals[name] = value;
    }
  }
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: saved.navigator });
});

/** Installs the bridge into a fake context and runs its init script here. */
const installHere = async (bridge: LedgerHidBridge): Promise<{ hid: PageHid; usb: unknown }> => {
  let script: ((config: FakeLedgerHidConfig) => void) | undefined;
  let config: FakeLedgerHidConfig | undefined;
  const context = {
    addInitScript: async (fn: (value: FakeLedgerHidConfig) => void, arg: FakeLedgerHidConfig) => {
      script = fn;
      config = arg;
    },
    exposeBinding: async (name: string, callback: (source: unknown, value: unknown) => unknown) => {
      globals[name] = (value: unknown) => callback({}, value);
    },
  };
  await bridge.install(context as unknown as BrowserContext);
  class Navigator {}
  globals["Navigator"] = Navigator;
  globals["window"] = globalThis;
  const page = new Navigator() as { hid?: PageHid; usb?: unknown };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: page });
  if (!script || !config) {
    throw new Error("install registered no init script");
  }
  script(config);
  return { hid: page.hid as PageHid, usb: page.usb };
};

const quitAppPacket = (): Uint8Array<ArrayBuffer> =>
  hostFraming(0x0101, 64).makeBlocks(Buffer.from([0xb0, 0xa7, 0, 0, 0]))[0] ?? new Uint8Array();

describe("page shim against the bridge", () => {
  test("grants, frames a dashboard reply, drops off the bus and comes back", async () => {
    const forwarded: Uint8Array[] = [];
    const bridge = new LedgerHidBridge({
      backend: { exchange: async (apdu) => (forwarded.push(apdu), Uint8Array.of(0x90, 0)) },
      model: "flex",
      reconnectMs: 30,
    });
    const { hid, usb } = await installHere(bridge);
    expect(usb).toBeUndefined();
    expect(await hid.getDevices()).toEqual([]);
    expect(await hid.requestDevice({ filters: [{ vendorId: 0x1111 }] })).toEqual([]);
    const [device] = await hid.requestDevice({ filters: [{ vendorId: 0x2c97 }] });
    if (!device) {
      throw new Error("no device");
    }
    expect([device.vendorId, device.productName, device.collections[0]?.usagePage]).toEqual([
      0x2c97,
      "Ledger Flex",
      0xffa0,
    ]);
    await expect(device.sendReport(0, quitAppPacket())).rejects.toThrow("write");
    await device.open();

    const reports: number[][] = [];
    device.addEventListener("inputreport", (event) =>
      reports.push(Array.from(new Uint8Array((event as Event & { data: DataView }).data.buffer))),
    );
    const disconnected = new Promise<unknown>((resolve) =>
      hid.addEventListener("disconnect", (event) =>
        resolve((event as Event & { device: unknown }).device),
      ),
    );
    const connected = new Promise<void>((resolve) =>
      hid.addEventListener("connect", () => resolve()),
    );
    await device.sendReport(0, quitAppPacket());
    expect(await disconnected).toBe(device);
    expect(device.opened).toBe(false);
    expect(reports.map((report) => report.slice(0, 9))).toEqual([
      [0x01, 0x01, 0x05, 0x00, 0x00, 0x00, 0x02, 0x90, 0x00],
    ]);
    expect(await hid.getDevices()).toEqual([]);
    await connected;
    expect(await hid.getDevices()).toEqual([device]);
    expect(forwarded).toEqual([]);
  });

  test("a missing binding refuses instead of answering", async () => {
    const bridge = new LedgerHidBridge({
      backend: { exchange: async () => new Uint8Array() },
      model: "nanosp",
    });
    const { hid } = await installHere(bridge);
    delete globals["__brambleLedgerHidBridge"];
    await expect(hid.getDevices()).rejects.toThrow("binding missing");
  });
});
