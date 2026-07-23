/**
 * Ledger grant-window boundary:
 *   - requestDeviceGrant opens the grant page as a focused popup with the
 *     pinned URL/type/dimensions, resolves only when THAT window closes (a
 *     different window closing must not resolve it), and always removes its
 *     `onRemoved` listener so repeated calls never leak listeners;
 *   - requestDeviceGrant resolves immediately, registering no listener at all,
 *     when the created window carries no id;
 *   - extensionBrowser narrows `globalThis.chrome` to the `GrantBrowser` shape
 *     this module needs, or returns null when the shape is missing or
 *     incomplete.
 * Everything is a fake `GrantBrowser` — no real `chrome.windows` or WebHID.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  extensionBrowser,
  type GrantBrowser,
  requestDeviceGrant,
} from "../src/sidepanel/ledger/grant-window";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type MutableGlobal = { chrome?: unknown };
const globalWithChrome = globalThis as unknown as MutableGlobal;

afterEach(() => {
  globalWithChrome.chrome = undefined;
});

type FakeWindow = { readonly id?: number };
type WindowsCreateOptions = Parameters<GrantBrowser["windows"]["create"]>[0];

const createFakeBrowser = (
  createdWindow: FakeWindow,
): {
  readonly browser: GrantBrowser;
  readonly createCalls: WindowsCreateOptions[];
  readonly listeners: Set<(windowId: number) => void>;
} => {
  const createCalls: WindowsCreateOptions[] = [];
  const listeners = new Set<(windowId: number) => void>();

  const browser: GrantBrowser = {
    runtime: {
      getURL: (path) => `chrome-extension://fake-id/${path}`,
    },
    windows: {
      create: async (options) => {
        createCalls.push(options);
        return createdWindow;
      },
      onRemoved: {
        addListener: (callback) => {
          listeners.add(callback);
        },
        removeListener: (callback) => {
          listeners.delete(callback);
        },
      },
    },
  };

  return { browser, createCalls, listeners };
};

describe("requestDeviceGrant", () => {
  test("opens the grant page as a focused popup with the pinned URL, type, and dimensions", async () => {
    const { browser, createCalls, listeners } = createFakeBrowser({ id: 7 });

    const pending = requestDeviceGrant(browser);
    await tick();

    expect(createCalls).toEqual([
      {
        focused: true,
        height: 420,
        type: "popup",
        url: "chrome-extension://fake-id/ledger-grant.html",
        width: 460,
      },
    ]);

    for (const listener of listeners) {
      listener(7);
    }
    await pending;
  });

  test("resolves only when the matching window id closes, and removes its listener", async () => {
    const { browser, listeners } = createFakeBrowser({ id: 11 });

    let resolved = false;
    const pending = requestDeviceGrant(browser).then(() => {
      resolved = true;
    });
    await tick();

    expect(listeners.size).toBe(1);

    for (const listener of listeners) {
      listener(99);
    }
    await tick();
    expect(resolved).toBe(false);
    expect(listeners.size).toBe(1);

    for (const listener of listeners) {
      listener(11);
    }
    await pending;

    expect(resolved).toBe(true);
    expect(listeners.size).toBe(0);
  });

  test("resolves immediately and registers no listener when the created window has no id", async () => {
    const { browser, listeners } = createFakeBrowser({});

    await requestDeviceGrant(browser);

    expect(listeners.size).toBe(0);
  });
});

describe("extensionBrowser", () => {
  test("returns null outside an extension context", () => {
    globalWithChrome.chrome = undefined;
    expect(extensionBrowser()).toBeNull();
  });

  test("returns null when chrome is missing the windows/runtime surface", () => {
    globalWithChrome.chrome = { runtime: {} };
    expect(extensionBrowser()).toBeNull();
  });

  test("returns null when onRemoved is missing addListener/removeListener", () => {
    globalWithChrome.chrome = {
      runtime: { getURL: (path: string) => path },
      windows: { create: async () => ({}), onRemoved: {} },
    };
    expect(extensionBrowser()).toBeNull();
  });

  test("returns the narrowed browser when the shape matches", () => {
    const { browser } = createFakeBrowser({ id: 1 });
    globalWithChrome.chrome = browser;
    expect(extensionBrowser()).toBe(browser);
  });
});
