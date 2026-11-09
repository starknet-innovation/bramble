/**
 * Bridge plumbing, no emulator needed (runs in the default offline suite and
 * CI, where the Speculos suite does not run). It checks two things that suite
 * depends on:
 * - the fake `navigator.hid` and its binding reach every extension page that
 *   opens the device: the side panel, and a tab the extension opens later
 *   (the Ledger grant tab), so no CDP fallback is needed;
 * - a framed `B0 A7` from a page is answered by the dashboard stand-in, never
 *   forwarded to the device, and drops the device off the bus until it
 *   reconnects.
 * It does not test Ledger behaviour; the backend here refuses every APDU.
 */
import { expect, test } from "../fixtures";
import { LEDGER_APDU_USAGE_PAGE, LEDGER_USB_VENDOR_ID, LedgerHidBridge } from "./hid-bridge";

type PageProbe = { readonly hid: boolean; readonly usb: boolean };
// The DOM lib ships no WebHID types; the slice these page functions touch.
type PageHidDevice = EventTarget & {
  readonly collections: readonly { readonly usagePage: number }[];
  readonly open: () => Promise<void>;
  readonly sendReport: (reportId: number, data: BufferSource) => Promise<void>;
  readonly vendorId: number;
};
type PageInputReport = Event & { readonly data: DataView };

// Runs in the page: grant, open, send one framed B0 A7, collect the reply and
// whether the device dropped and came back.
const quitAppThroughFakeHid = async (): Promise<{
  readonly afterReconnect: number;
  readonly duringDisconnect: number;
  readonly reply: number[];
}> => {
  const hid = (navigator as unknown as { hid: EventTarget & Record<string, unknown> }).hid;
  const request = hid["requestDevice"] as (o: unknown) => Promise<PageHidDevice[]>;
  const getDevices = hid["getDevices"] as () => Promise<PageHidDevice[]>;
  const [device] = await request({ filters: [{ vendorId: 0x2c97 }] });
  if (!device) {
    throw new Error("no device granted");
  }
  await device.open();
  const packet = new Uint8Array(64);
  packet.set([0x01, 0x01, 0x05, 0x00, 0x00, 0x00, 0x05, 0xb0, 0xa7, 0x00, 0x00, 0x00]);
  const disconnected = new Promise<void>((resolve) =>
    hid.addEventListener("disconnect", () => resolve(), { once: true }),
  );
  const replied = new Promise<number[]>((resolve) =>
    device.addEventListener(
      "inputreport",
      (event: Event) => resolve(Array.from(new Uint8Array((event as PageInputReport).data.buffer))),
      { once: true },
    ),
  );
  await device.sendReport(0, packet);
  const reply = await replied;
  await disconnected;
  const duringDisconnect = (await getDevices()).length;
  await new Promise((resolve) => setTimeout(resolve, 600));
  return { afterReconnect: (await getDevices()).length, duringDisconnect, reply };
};

test("fake HID reaches the side panel and a later extension tab", async ({ extension }) => {
  const forwarded: string[] = [];
  const bridge = new LedgerHidBridge({
    backend: {
      exchange: async (apdu) => {
        forwarded.push(Buffer.from(apdu).toString("hex"));
        throw new Error("no device behind this bridge");
      },
    },
    model: "nanosp",
  });
  await bridge.install(extension.context);
  const probe = (): PageProbe => {
    const fake = (navigator as unknown as { hid?: { getDevices?: unknown } }).hid;
    return {
      hid: typeof fake?.getDevices === "function",
      usb: (navigator as unknown as { usb?: unknown }).usb !== undefined,
    };
  };

  const panel = await extension.openExtensionPage("sidepanel.html");
  expect(await panel.evaluate(probe)).toEqual({ hid: true, usb: false });

  const opened = extension.context.waitForEvent("page");
  await panel.evaluate(() => {
    const api = (
      globalThis as unknown as {
        readonly chrome: {
          readonly runtime: { readonly getURL: (path: string) => string };
          readonly tabs: { readonly create: (o: { active: boolean; url: string }) => unknown };
        };
      }
    ).chrome;
    api.tabs.create({ active: true, url: api.runtime.getURL("ledger-grant.html") });
  });
  const grantTab = await opened;
  await grantTab.waitForLoadState();
  expect(grantTab.url()).toContain("/ledger-grant.html");
  expect(await grantTab.evaluate(probe)).toEqual({ hid: true, usb: false });

  const device = await grantTab.evaluate(async () => {
    const hid = (
      navigator as unknown as { hid: { requestDevice: (o: unknown) => Promise<PageHidDevice[]> } }
    ).hid;
    const [granted] = await hid.requestDevice({ filters: [{ vendorId: 0x2c97 }] });
    return { usagePage: granted?.collections[0]?.usagePage, vendorId: granted?.vendorId };
  });
  expect(device).toEqual({ usagePage: LEDGER_APDU_USAGE_PAGE, vendorId: LEDGER_USB_VENDOR_ID });
  expect(bridge.isGranted).toBe(true);

  const result = await panel.evaluate(quitAppThroughFakeHid);
  // Channel 0x0101, tag 0x05, sequence 0, length 2, then 90 00.
  expect(result.reply.slice(0, 9)).toEqual([0x01, 0x01, 0x05, 0x00, 0x00, 0x00, 0x02, 0x90, 0x00]);
  expect(result.duringDisconnect).toBe(0);
  expect(result.afterReconnect).toBe(1);
  expect(bridge.location()).toBe("dashboard");
  expect(forwarded).toEqual([]);
});
