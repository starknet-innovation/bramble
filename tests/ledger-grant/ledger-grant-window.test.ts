/**
 * Retained Ledger-tab boundary: an ordinary active tab is opened with a
 * per-session capability, resolves only after its validated broker reports
 * ready, proxies typed device calls, and tears every resource down on
 * close/timeout. The tab surface is pinned so the broken popup-window chooser
 * cannot be reintroduced.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { ledgerBrokerChannelName } from "../../src/ledger-grant/broker-protocol";
import {
  extensionBrowser,
  type GrantBrowser,
  type GrantClientChannel,
  type GrantSessionRuntime,
  requestDeviceGrant,
} from "../../src/sidepanel/ledger/grant-window";
import { ledgerAccountPath } from "../../src/starknet/ledger-path";

const SESSION_ID = "00000000-0000-4000-8000-000000000001";
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type MutableGlobal = { chrome?: unknown };
const globalWithChrome = globalThis as unknown as MutableGlobal;

afterEach(() => {
  globalWithChrome.chrome = undefined;
});

type FakeTab = { readonly id?: number };
type TabsCreateOptions = Parameters<GrantBrowser["tabs"]["create"]>[0];

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
  createdTab: FakeTab,
  missingOnGet = false,
  failOnRemove = false,
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
        if (failOnRemove) {
          throw new Error(`Could not remove tab: ${tabId}`);
        }
      },
    },
  };

  return { browser, createCalls, getCalls, listeners, removeCalls };
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
  test("uses the bounded production channel runtime", async () => {
    const { browser, createCalls } = createFakeBrowser({ id: 6 });
    const pending = requestDeviceGrant(browser);
    await tick();
    const createdUrl = createCalls[0]?.url;
    if (!createdUrl) {
      throw new Error("grant tab was not created");
    }
    const sessionId = new URL(createdUrl).hash.replace("#session=", "");
    const broker = new BroadcastChannel(ledgerBrokerChannelName(sessionId));
    broker.postMessage({ kind: "ready" });

    const session = await pending;
    await session.close();
    broker.close();
  });

  test("opens a capability-scoped active tab and waits for ready", async () => {
    const fake = createFakeChannel();
    const { browser, createCalls } = createFakeBrowser({ id: 7 });
    const pending = requestDeviceGrant(browser, createRuntime(fake));
    await tick();

    expect(createCalls).toEqual([
      {
        active: true,
        url: `chrome-extension://fake-id/ledger-grant.html#session=${SESSION_ID}`,
      },
    ]);
    expect(Object.keys({ ...createCalls[0] }).sort()).toEqual(["active", "url"]);
    fake.emit({ kind: "ready" });
    const session = await pending;
    expect(session.readiness).toBe("verified");
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

  test("proxies and validates the read-only OS version response", async () => {
    const fake = createFakeChannel();
    const { browser } = createFakeBrowser({ id: 31 });
    const pending = requestDeviceGrant(browser, createRuntime(fake));
    await tick();
    fake.emit({ kind: "ready" });
    const session = await pending;

    const version = session.client.getOsVersion();
    await tick();
    expect(fake.posts[0]).toEqual({ id: 1, kind: "command", method: "getOsVersion" });
    fake.emit({
      id: 1,
      kind: "response",
      ok: true,
      value: { targetId: 0x33000004, version: "2.7.1" },
    });
    await expect(version).resolves.toEqual({ targetId: 0x33000004, version: "2.7.1" });
    await session.close();
  });

  test("proxies validated public-key and signature responses", async () => {
    const fake = createFakeChannel();
    const { browser } = createFakeBrowser({ id: 12 });
    const pending = requestDeviceGrant(browser, createRuntime(fake));
    await tick();
    fake.emit({ kind: "ready" });
    const session = await pending;
    const path = ledgerAccountPath(0);

    const publicKey = session.client.getPubKey(path);
    await tick();
    expect(fake.posts[0]).toEqual({
      id: 1,
      kind: "command",
      method: "getPubKey",
      path,
    });
    fake.emit({
      id: 1,
      kind: "response",
      ok: true,
      value: {
        errorMessage: "",
        publicKey: new Uint8Array(64),
        returnCode: 0x9000,
      },
    });
    expect((await publicKey).publicKey).toEqual(new Uint8Array(64));

    const signature = session.client.signHash(path, "0x1");
    await tick();
    expect(fake.posts[1]).toEqual({
      hash: "0x1",
      id: 2,
      kind: "command",
      method: "signHash",
      path,
    });
    fake.emit({
      id: 2,
      kind: "response",
      ok: true,
      value: {
        errorMessage: "",
        r: new Uint8Array(32),
        returnCode: 0x9000,
        s: new Uint8Array(32),
      },
    });
    expect(await signature).toMatchObject({
      r: new Uint8Array(32),
      returnCode: 0x9000,
      s: new Uint8Array(32),
    });
    await session.close();
  });

  test("rejects broker failures and bounded command timeouts", async () => {
    const fake = createFakeChannel();
    const timers: Array<() => void> = [];
    const { browser } = createFakeBrowser({ id: 14 });
    const pending = requestDeviceGrant(browser, createRuntime(fake, timers));
    await tick();
    fake.emit({ kind: "ready" });
    const session = await pending;

    const rejected = session.client.getAppVersion();
    await tick();
    fake.emit({
      error: "device-busy",
      id: 1,
      kind: "response",
      ok: false,
    });
    await expect(rejected).rejects.toMatchObject({ code: "device-busy" });

    const timedOut = session.client.getAppVersion();
    await tick();
    timers.at(-1)?.();
    await expect(timedOut).rejects.toMatchObject({ code: "sign-timeout" });
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

  test("fails closed on a malformed OS version response", async () => {
    const fake = createFakeChannel();
    const { browser } = createFakeBrowser({ id: 32 });
    const pending = requestDeviceGrant(browser, createRuntime(fake));
    await tick();
    fake.emit({ kind: "ready" });
    const session = await pending;

    const version = session.client.getOsVersion();
    await tick();
    fake.emit({
      id: 1,
      kind: "response",
      ok: true,
      value: { targetId: -1, version: "2.7.1" },
    });
    await expect(version).rejects.toMatchObject({ code: "unexpected-device-error" });
    await session.close();
  });

  test("closing the owned session signals the broker and removes its exact tab", async () => {
    const fake = createFakeChannel();
    const { browser, listeners, removeCalls } = createFakeBrowser({ id: 17 }, false, true);
    const pending = requestDeviceGrant(browser, createRuntime(fake));
    await tick();
    fake.emit({ kind: "ready" });
    const session = await pending;

    await session.close();
    expect(fake.posts).toEqual([{ kind: "close" }]);
    expect(removeCalls).toEqual([17]);
    expect(listeners.size).toBe(0);
  });

  test("rejects active calls when the retained tab closes", async () => {
    const fake = createFakeChannel();
    const { browser, listeners } = createFakeBrowser({ id: 18 });
    const pending = requestDeviceGrant(browser, createRuntime(fake));
    await tick();
    fake.emit({ kind: "ready" });
    const session = await pending;
    const version = session.client.getAppVersion();
    await tick();

    for (const listener of listeners) {
      listener(18);
    }

    await expect(version).rejects.toMatchObject({ code: "panel-context-lost" });
  });

  test("ignores unrelated tab closes and rejects when its tab closes before ready", async () => {
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
    const { browser, listeners, removeCalls } = createFakeBrowser({ id: 23 }, false, true);
    const pending = requestDeviceGrant(browser, createRuntime(fake, timers));
    await tick();

    timers[0]?.();
    await expect(pending).rejects.toMatchObject({ code: "picker-cancelled" });
    expect(listeners.size).toBe(0);
    expect(removeCalls).toEqual([23]);
  });

  test("rejects a created tab that has no trackable id", async () => {
    const fake = createFakeChannel();
    const { browser, listeners } = createFakeBrowser({});
    await expect(requestDeviceGrant(browser, createRuntime(fake))).rejects.toMatchObject({
      code: "unexpected-device-error",
    });
    expect(listeners.size).toBe(0);
  });

  test("detects a tab that closed during creation", async () => {
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

  test("returns null when chrome is missing the tabs/runtime surface", () => {
    globalWithChrome.chrome = { runtime: {} };
    expect(extensionBrowser()).toBeNull();
  });

  test("returns null when tab lifecycle methods are missing", () => {
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
