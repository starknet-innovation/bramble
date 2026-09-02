/**
 * The panel-side proxy. The tab is a resource the panel does not control, so
 * these tests are about what happens when it misbehaves: closed before ready,
 * closed mid-request, a reply of the wrong shape for the command it answers, a
 * reply that never comes, and a tab Chrome refused to open. Every one of those
 * must settle a promise, because a request left hanging is a wallet that never
 * tells the user anything.
 */
import { describe, expect, test } from "bun:test";
import {
  PQ_DEVICE_TAB_PAGE,
  type PqClientChannel,
  type PqDeviceBrowser,
  type PqSessionRuntime,
  requestPqDeviceSession,
} from "@mc-wallet/pq-transport/grant-window";
import { PQ_BROKER_CHANNEL_PREFIX } from "@mc-wallet/pq-transport/protocol";

const SESSION_ID = "00000000-0000-4000-8000-000000000001";
const OFFER = "eyJjaGFsbGVuZ2UiOiIweDEifQ";
const PAIRING_REPLY = "eyJkZXZpY2VJZCI6IlBpeGVsIn0";
const SIGNED_REPLY = `0x${"ab".repeat(3309)}`;
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const createFakeChannel = (): {
  readonly channel: PqClientChannel;
  readonly emit: (data: unknown) => void;
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
      for (const listener of [...listeners]) {
        listener({ data } as MessageEvent<unknown>);
      }
    },
    posts,
  };
};

const createFakeBrowser = (
  tab: { readonly id?: number },
  failCreate = false,
): {
  readonly browser: PqDeviceBrowser;
  readonly closeTab: (tabId: number) => void;
  readonly created: string[];
  readonly removed: number[];
} => {
  const listeners = new Set<(tabId: number) => void>();
  const created: string[] = [];
  const removed: number[] = [];
  return {
    browser: {
      runtime: { getURL: (path) => `chrome-extension://fake/${path}` },
      tabs: {
        create: async (options) => {
          if (failCreate) {
            throw new Error("cannot create tab");
          }
          created.push(options.url);
          return tab;
        },
        get: async (tabId) => ({ id: tabId }),
        onRemoved: {
          addListener: (callback) => {
            listeners.add(callback);
          },
          removeListener: (callback) => {
            listeners.delete(callback);
          },
        },
        remove: async (tabId) => {
          removed.push(tabId);
        },
      },
    },
    closeTab: (tabId) => {
      for (const listener of [...listeners]) {
        listener(tabId);
      }
    },
    created,
    removed,
  };
};

const createRuntime = (
  fake: ReturnType<typeof createFakeChannel>,
  readyTimers: Array<() => void> = [],
  commandTimers: Array<() => void> = [],
): PqSessionRuntime => ({
  channel: (name) => {
    expect(name).toBe(`${PQ_BROKER_CHANNEL_PREFIX}${SESSION_ID}`);
    return fake.channel;
  },
  command: {
    ms: 900_000,
    schedule: (onElapsed) => {
      commandTimers.push(onElapsed);
      return () => undefined;
    },
  },
  ready: {
    ms: 120_000,
    schedule: (onElapsed) => {
      readyTimers.push(onElapsed);
      return () => undefined;
    },
  },
  sessionId: () => SESSION_ID,
});

const openSession = async (
  fake: ReturnType<typeof createFakeChannel>,
  browser: PqDeviceBrowser,
) => {
  const pending = requestPqDeviceSession(browser, createRuntime(fake));
  await tick();
  fake.emit({ kind: "ready" });
  return pending;
};

describe("requestPqDeviceSession", () => {
  test("opens the device page in an active tab with a session capability", async () => {
    const fake = createFakeChannel();
    const { browser, created } = createFakeBrowser({ id: 7 });

    const session = await openSession(fake, browser);

    expect(created).toEqual([
      `chrome-extension://fake/${PQ_DEVICE_TAB_PAGE}#session=${SESSION_ID}`,
    ]);
    await session.close();
  });

  test("proxies pair and sign, and validates each reply against its own command", async () => {
    const fake = createFakeChannel();
    const { browser } = createFakeBrowser({ id: 8 });
    const session = await openSession(fake, browser);

    const paired = session.pair(OFFER);
    await tick();
    expect(fake.posts[0]).toEqual({ id: 1, kind: "command", method: "pair", offer: OFFER });
    fake.emit({ id: 1, kind: "response", ok: true, value: PAIRING_REPLY });
    await expect(paired).resolves.toBe(PAIRING_REPLY);

    const signed = session.sign(OFFER);
    await tick();
    expect(fake.posts[1]).toEqual({ envelope: OFFER, id: 2, kind: "command", method: "sign" });
    fake.emit({ id: 2, kind: "response", ok: true, value: SIGNED_REPLY });
    await expect(signed).resolves.toBe(SIGNED_REPLY);

    await session.close();
  });

  test("refuses a signing reply that is only a well-formed pairing reply", async () => {
    const fake = createFakeChannel();
    const { browser } = createFakeBrowser({ id: 9 });
    const session = await openSession(fake, browser);

    const signed = session.sign(OFFER);
    await tick();
    // The tab checks this too. The panel checks again because a value that
    // crossed a channel is untrusted, and because hex is valid base64url, so
    // only the command can say which shape was expected.
    fake.emit({ id: 1, kind: "response", ok: true, value: PAIRING_REPLY });

    await expect(signed).rejects.toMatchObject({ code: "malformed-reply" });
    await session.close();
  });

  test("a tab closed before ready is a cancelled chooser", async () => {
    const fake = createFakeChannel();
    const { browser, closeTab } = createFakeBrowser({ id: 10 });
    const pending = requestPqDeviceSession(browser, createRuntime(fake));
    await tick();
    closeTab(10);

    await expect(pending).rejects.toMatchObject({ code: "picker-cancelled" });
  });

  test("a tab closed mid-request settles it as a lost context", async () => {
    const fake = createFakeChannel();
    const { browser, closeTab } = createFakeBrowser({ id: 11 });
    const session = await openSession(fake, browser);

    const signed = session.sign(OFFER);
    await tick();
    closeTab(11);

    await expect(signed).rejects.toMatchObject({ code: "panel-context-lost" });
    // A request issued after the tab is gone must fail immediately, not hang.
    await expect(session.sign(OFFER)).rejects.toMatchObject({ code: "panel-context-lost" });
  });

  test("bounds the wait for ready and for a reply", async () => {
    const fake = createFakeChannel();
    const readyTimers: Array<() => void> = [];
    const { browser, removed } = createFakeBrowser({ id: 12 });
    const pending = requestPqDeviceSession(browser, createRuntime(fake, readyTimers));
    await tick();
    readyTimers.at(-1)?.();
    await expect(pending).rejects.toMatchObject({ code: "picker-cancelled" });
    expect(removed).toEqual([12]);

    const second = createFakeChannel();
    const commandTimers: Array<() => void> = [];
    const { browser: browser2 } = createFakeBrowser({ id: 13 });
    const opening = requestPqDeviceSession(browser2, createRuntime(second, [], commandTimers));
    await tick();
    second.emit({ kind: "ready" });
    const session = await opening;

    const signed = session.sign(OFFER);
    await tick();
    commandTimers.at(-1)?.();
    await expect(signed).rejects.toMatchObject({ code: "request-timeout" });
    await session.close();
  });

  test("a tab Chrome refused to open rejects rather than resolving a dead session", async () => {
    const fake = createFakeChannel();
    const { browser } = createFakeBrowser({ id: 14 }, true);

    await expect(requestPqDeviceSession(browser, createRuntime(fake))).rejects.toMatchObject({
      code: "unexpected-device-error",
    });
  });

  test("close tells the tab, removes it, and is safe to call twice", async () => {
    const fake = createFakeChannel();
    const { browser, removed } = createFakeBrowser({ id: 15 });
    const session = await openSession(fake, browser);

    await session.close();
    await session.close();

    expect(fake.posts).toEqual([{ kind: "close" }]);
    expect(removed).toEqual([15]);
  });
});
