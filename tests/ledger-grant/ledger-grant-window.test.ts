/**
 * Ledger grant-tab boundary:
 *   - requestDeviceGrant opens the grant page as an active TAB with the pinned
 *     URL — never a `chrome.windows` popup, which is the context where Chrome
 *     resolves `navigator.hid.requestDevice()` with an empty device list even
 *     for a connected, unlocked Ledger;
 *   - it resolves only when THAT tab closes (a different tab closing must not
 *     resolve it), and always removes its `onRemoved` listener so repeated
 *     calls never leak listeners;
 *   - it resolves immediately, registering no listener at all, when the created
 *     tab carries no id;
 *   - extensionBrowser narrows `globalThis.chrome` to the `GrantBrowser` shape
 *     this module needs, or returns null when the shape is missing, incomplete,
 *     or is the superseded `chrome.windows` surface.
 * Everything is a fake `GrantBrowser` — no real `chrome.tabs` or WebHID.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  extensionBrowser,
  type GrantBrowser,
  requestDeviceGrant,
} from "../../src/sidepanel/ledger/grant-window";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type MutableGlobal = { chrome?: unknown };
const globalWithChrome = globalThis as unknown as MutableGlobal;

afterEach(() => {
  globalWithChrome.chrome = undefined;
});

type FakeTab = { readonly id?: number };
type TabsCreateOptions = Parameters<GrantBrowser["tabs"]["create"]>[0];

const createFakeBrowser = (
  createdTab: FakeTab,
  missingOnGet = false,
): {
  readonly browser: GrantBrowser;
  readonly createCalls: TabsCreateOptions[];
  readonly getCalls: number[];
  readonly listeners: Set<(tabId: number) => void>;
  readonly removeCalls: number[];
} => {
  const createCalls: TabsCreateOptions[] = [];
  const getCalls: number[] = [];
  const listeners = new Set<(tabId: number) => void>();
  const removeCalls: number[] = [];

  const browser: GrantBrowser = {
    runtime: {
      getURL: (path) => `chrome-extension://fake-id/${path}`,
    },
    tabs: {
      create: async (options) => {
        createCalls.push(options);
        return createdTab;
      },
      get: async (tabId) => {
        getCalls.push(tabId);
        if (missingOnGet) {
          throw new Error(`No tab with id: ${tabId}`);
        }
        return { id: tabId };
      },
      onRemoved: {
        addListener: (callback) => {
          listeners.add(callback);
        },
        removeListener: (callback) => {
          listeners.delete(callback);
        },
      },
      remove: async (tabId) => {
        removeCalls.push(tabId);
      },
    },
  };

  return { browser, createCalls, getCalls, listeners, removeCalls };
};

describe("requestDeviceGrant", () => {
  test("opens the grant page as an active tab with the pinned URL", async () => {
    const { browser, createCalls, listeners } = createFakeBrowser({ id: 7 });

    const pending = requestDeviceGrant(browser);
    await tick();

    expect(createCalls).toEqual([
      {
        active: true,
        url: "chrome-extension://fake-id/ledger-grant.html",
      },
    ]);

    for (const listener of listeners) {
      listener(7);
    }
    await pending;
  });

  test("never opens a popup window: the created surface carries no window options", async () => {
    const { browser, createCalls, listeners } = createFakeBrowser({ id: 8 });

    const pending = requestDeviceGrant(browser);
    await tick();

    // Chrome returns an empty HID device list from a `type: "popup"` window, so
    // any reappearance of window-shaped options (`type`, `width`, `height`,
    // `focused`) here is the original bug. Pinning the exact key set rejects all
    // of them, and anything else added without a test.
    expect(Object.keys({ ...createCalls[0] }).sort()).toEqual(["active", "url"]);

    for (const listener of listeners) {
      listener(8);
    }
    await pending;
  });

  test("resolves only when the matching tab id closes, and removes its listener", async () => {
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

  test("resolves immediately and registers no listener when the created tab has no id", async () => {
    const { browser, listeners } = createFakeBrowser({});

    await requestDeviceGrant(browser);

    expect(listeners.size).toBe(0);
  });

  test("bounds a tab that never closes and removes it without leaking the listener", async () => {
    const { browser, listeners, removeCalls } = createFakeBrowser({ id: 13 });
    const timers: Array<() => void> = [];
    const pending = requestDeviceGrant(browser, {
      ms: 1_000,
      schedule: (onElapsed) => {
        timers.push(onElapsed);
        return () => undefined;
      },
    });
    await tick();

    expect(listeners.size).toBe(1);
    timers[0]?.();
    await pending;
    expect(listeners.size).toBe(0);
    expect(removeCalls).toEqual([13]);
  });

  test("detects a tab that closed before its listener was registered", async () => {
    const { browser, getCalls, listeners } = createFakeBrowser({ id: 17 }, true);

    await requestDeviceGrant(browser);

    expect(getCalls).toEqual([17]);
    expect(listeners.size).toBe(0);
  });
});

describe("extensionBrowser", () => {
  test("returns null outside an extension context", () => {
    globalWithChrome.chrome = undefined;
    expect(extensionBrowser()).toBeNull();
  });

  test("returns null when chrome is missing the tabs/runtime surface", () => {
    globalWithChrome.chrome = { runtime: {} };
    expect(extensionBrowser()).toBeNull();
  });

  test("returns null when onRemoved is missing addListener/removeListener", () => {
    globalWithChrome.chrome = {
      runtime: { getURL: (path: string) => path },
      tabs: { create: async () => ({}), onRemoved: {} },
    };
    expect(extensionBrowser()).toBeNull();
  });

  test("returns null for the superseded chrome.windows surface", () => {
    globalWithChrome.chrome = {
      runtime: { getURL: (path: string) => path },
      windows: {
        create: async () => ({}),
        get: async () => ({}),
        onRemoved: { addListener: () => undefined, removeListener: () => undefined },
        remove: async () => undefined,
      },
    };
    expect(extensionBrowser()).toBeNull();
  });

  test("returns the narrowed browser when the shape matches", () => {
    const { browser } = createFakeBrowser({ id: 1 });
    globalWithChrome.chrome = browser;
    expect(extensionBrowser()).toBe(browser);
  });
});
