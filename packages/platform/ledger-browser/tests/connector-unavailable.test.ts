/**
 * The browser Ledger connector in a runtime with no Ledger transport (Firefox
 * has no WebHID, WebUSB or Web Bluetooth). `request` must answer with the
 * browser-support rejection at once, and must not open the grant tab, which
 * could only report the same thing after the user had left the side panel.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { ledgerConnector } from "@bramble/ledger-browser/connector";
import { isLedgerTransportAvailable } from "@bramble/ledger-browser/transport";
import { LedgerRejection } from "@bramble/ledger-protocol/errors";

type MutableGlobal = { browser?: unknown; chrome?: unknown };
const scope = globalThis as unknown as MutableGlobal;

afterEach(() => {
  scope.browser = undefined;
  scope.chrome = undefined;
});

// A complete extension surface, so a missing browser is not what stops the tab.
const extensionWithTabs = (opened: string[]) => ({
  runtime: { getURL: (path: string) => `moz-extension://bramble/${path}` },
  tabs: {
    create: async (options: { readonly url?: string }) => {
      opened.push(options.url ?? "");
      return { id: 1 };
    },
    get: async () => ({ id: 1 }),
    onRemoved: { addListener: () => undefined, removeListener: () => undefined },
    remove: async () => undefined,
  },
});

describe("ledgerConnector without a Ledger transport", () => {
  test("the test runtime has no Ledger transport", () => {
    expect(isLedgerTransportAvailable()).toBe(false);
    expect(ledgerConnector.isAvailable?.()).toBe(false);
  });

  test("request refuses with the browser-support rejection and opens no grant tab", async () => {
    const opened: string[] = [];
    scope.browser = extensionWithTabs(opened);

    const failure = await ledgerConnector.request().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(LedgerRejection);
    expect((failure as LedgerRejection).code).toBe("webhid-unavailable");
    expect(opened).toEqual([]);
  });

  test("lists no granted device and reconnects to none", async () => {
    await expect(ledgerConnector.listConnected?.() ?? Promise.resolve([])).resolves.toEqual([]);
    await expect(ledgerConnector.openConnected()).resolves.toBeNull();
  });
});

describe("ledgerConnector with a cable transport but no granted device", () => {
  // A WebHID surface with nothing granted, and no extension browser to open
  // the grant tab with: `request` passes the gate, finds no device, and ends
  // on the same browser-support rejection rather than a generic device error.
  const withHid = (run: () => Promise<void>) => async () => {
    const hid = {
      addEventListener: () => undefined,
      getDevices: async () => [],
      removeEventListener: () => undefined,
      requestDevice: async () => [],
    };
    Object.defineProperty(navigator, "hid", { configurable: true, value: hid });
    try {
      await run();
    } finally {
      Reflect.deleteProperty(navigator, "hid");
    }
  };

  test(
    "request reaches the end of its routes and refuses",
    withHid(async () => {
      expect(isLedgerTransportAvailable()).toBe(true);
      const failure = await ledgerConnector.request().catch((error: unknown) => error);
      expect((failure as LedgerRejection).code).toBe("webhid-unavailable");
    }),
  );
});
