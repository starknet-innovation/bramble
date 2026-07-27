/**
 * Retained Ledger-window boundary: the popup is opened with a per-session
 * capability, resolves only after its validated broker reports ready, proxies
 * typed device calls, refocuses the parent wallet window, and tears every
 * resource down on close/timeout.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  extensionBrowser,
  type GrantBrowser,
  type GrantClientChannel,
  type GrantSessionRuntime,
  requestDeviceGrant,
} from "../../src/sidepanel/ledger/grant-window";

const SESSION_ID = "00000000-0000-4000-8000-000000000001";
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type MutableGlobal = { chrome?: unknown };
const globalWithChrome = globalThis as unknown as MutableGlobal;

afterEach(() => {
  globalWithChrome.chrome = undefined;
});

type FakeWindow = { readonly id?: number };
type WindowsCreateOptions = Parameters<GrantBrowser["windows"]["create"]>[0];

const createFakeChannel = (): {
  readonly channel: GrantClientChannel;
  readonly emit: (data: unknown) => void;
  readonly listeners: Set<(event: MessageEvent<unknown>) => void>;
  readonly posts: unknown[];
} => {
  const listeners = new Set<(event: MessageEvent<unknown>) => void>();
  const posts: unknown[] = [];
  return {
    channel: {
      addEventListener: (_type, listener) => {
        listeners.add(listener);
      },
      close: () => undefined,
      postMessage: (message) => {
        posts.push(message);
      },
      removeEventListener: (_type, listener) => {
        listeners.delete(listener);
      },
    },
    emit: (data) => {
      for (const listener of listeners) {
        listener({ data } as MessageEvent<unknown>);
      }
    },
    listeners,
    posts,
  };
};

const createFakeBrowser = (
  createdWindow: FakeWindow,
  missingOnGet = false,
): {
  readonly browser: GrantBrowser;
  readonly createCalls: WindowsCreateOptions[];
  readonly getCalls: number[];
  readonly listeners: Set<(windowId: number) => void>;
  readonly removeCalls: number[];
  readonly updateCalls: Array<readonly [number, { readonly focused: true }]>;
} => {
  const createCalls: WindowsCreateOptions[] = [];
  const getCalls: number[] = [];
  const listeners = new Set<(windowId: number) => void>();
  const removeCalls: number[] = [];
  const updateCalls: Array<readonly [number, { readonly focused: true }]> = [];

  const browser: GrantBrowser = {
    runtime: {
      getURL: (path) => `chrome-extension://fake-id/${path}`,
    },
    windows: {
      create: async (options) => {
        createCalls.push(options);
        return createdWindow;
      },
      get: async (windowId) => {
        getCalls.push(windowId);
        if (missingOnGet) {
          throw new Error(`No window with id: ${windowId}`);
        }
        return { id: windowId };
      },
      getCurrent: async () => ({ id: 3 }),
      onRemoved: {
        addListener: (callback) => {
          listeners.add(callback);
        },
        removeListener: (callback) => {
          listeners.delete(callback);
        },
      },
      remove: async (windowId) => {
        removeCalls.push(windowId);
      },
      update: async (windowId, options) => {
        updateCalls.push([windowId, options]);
        return { id: windowId };
      },
    },
  };

  return { browser, createCalls, getCalls, listeners, removeCalls, updateCalls };
};

const createRuntime = (
  fake: ReturnType<typeof createFakeChannel>,
  timers: Array<() => void> = [],
): GrantSessionRuntime => ({
  channel: (name) => {
    expect(name).toBe(`mc-wallet-ledger-v1:${SESSION_ID}`);
    return fake.channel;
  },
  sessionId: () => SESSION_ID,
  timeout: {
    ms: 1_000,
    schedule: (onElapsed) => {
      timers.push(onElapsed);
      return () => undefined;
    },
  },
});

describe("requestDeviceGrant", () => {
  test("opens a capability-scoped popup, waits for ready, and refocuses the wallet", async () => {
    const fake = createFakeChannel();
    const { browser, createCalls, updateCalls } = createFakeBrowser({ id: 7 });
    const pending = requestDeviceGrant(browser, createRuntime(fake));
    await tick();

    expect(createCalls).toEqual([
      {
        focused: true,
        height: 680,
        type: "popup",
        url: `chrome-extension://fake-id/ledger-grant.html#session=${SESSION_ID}`,
        width: 500,
      },
    ]);
    fake.emit({ kind: "ready" });
    const session = await pending;
    expect(updateCalls).toEqual([[3, { focused: true }]]);
    await session.close();
  });

  test("proxies and validates app-version responses before resolving the client call", async () => {
    const fake = createFakeChannel();
    const { browser } = createFakeBrowser({ id: 11 });
    const pending = requestDeviceGrant(browser, createRuntime(fake));
    await tick();
    fake.emit({ kind: "ready" });
    const session = await pending;

    const version = session.client.getAppVersion();
    await tick();
    expect(fake.posts[0]).toEqual({ id: 1, kind: "command", method: "getAppVersion" });
    fake.emit({
      id: 1,
      kind: "response",
      ok: true,
      value: { errorMessage: "No errors", major: 2, minor: 4, patch: 1, returnCode: 0x9000 },
    });
    expect(await version).toEqual({
      errorMessage: "No errors",
      major: 2,
      minor: 4,
      patch: 1,
      returnCode: 0x9000,
    });
    await session.close();
  });

  test("fails closed on a malformed device response", async () => {
    const fake = createFakeChannel();
    const { browser } = createFakeBrowser({ id: 13 });
    const pending = requestDeviceGrant(browser, createRuntime(fake));
    await tick();
    fake.emit({ kind: "ready" });
    const session = await pending;

    const publicKey = session.client.getPubKey("m/2645'/1195502025'/734980059'/0'/0'/0");
    await tick();
    fake.emit({
      id: 1,
      kind: "response",
      ok: true,
      value: { errorMessage: "", publicKey: new Uint8Array(63), returnCode: 0x9000 },
    });
    await expect(publicKey).rejects.toMatchObject({ code: "unexpected-device-error" });
    await session.close();
  });

  test("closing the owned session signals the broker and removes its exact window", async () => {
    const fake = createFakeChannel();
    const { browser, listeners, removeCalls } = createFakeBrowser({ id: 17 });
    const pending = requestDeviceGrant(browser, createRuntime(fake));
    await tick();
    fake.emit({ kind: "ready" });
    const session = await pending;

    await session.close();
    expect(fake.posts).toEqual([{ kind: "close" }]);
    expect(removeCalls).toEqual([17]);
    expect(listeners.size).toBe(0);
  });

  test("ignores unrelated window closes and rejects when its popup closes before ready", async () => {
    const fake = createFakeChannel();
    const { browser, listeners } = createFakeBrowser({ id: 19 });
    const pending = requestDeviceGrant(browser, createRuntime(fake));
    await tick();
    for (const listener of listeners) {
      listener(99);
    }
    expect(listeners.size).toBe(1);
    for (const listener of listeners) {
      listener(19);
    }
    await expect(pending).rejects.toMatchObject({ code: "picker-cancelled" });
    expect(listeners.size).toBe(0);
  });

  test("bounds a picker that never becomes ready", async () => {
    const fake = createFakeChannel();
    const timers: Array<() => void> = [];
    const { browser, listeners, removeCalls } = createFakeBrowser({ id: 23 });
    const pending = requestDeviceGrant(browser, createRuntime(fake, timers));
    await tick();

    timers[0]?.();
    await expect(pending).rejects.toMatchObject({ code: "picker-cancelled" });
    expect(listeners.size).toBe(0);
    expect(removeCalls).toEqual([23]);
  });

  test("rejects a created popup that has no trackable window id", async () => {
    const fake = createFakeChannel();
    const { browser, listeners } = createFakeBrowser({});
    await expect(requestDeviceGrant(browser, createRuntime(fake))).rejects.toMatchObject({
      code: "unexpected-device-error",
    });
    expect(listeners.size).toBe(0);
  });

  test("detects a popup that closed during creation", async () => {
    const fake = createFakeChannel();
    const { browser, getCalls } = createFakeBrowser({ id: 29 }, true);
    const pending = requestDeviceGrant(browser, createRuntime(fake));
    await expect(pending).rejects.toMatchObject({ code: "picker-cancelled" });
    expect(getCalls).toEqual([29]);
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

  test("returns null when focus/update lifecycle methods are missing", () => {
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
