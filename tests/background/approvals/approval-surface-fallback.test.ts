/**
 * Window fallback tests: a dapp request must still show the wallet when the
 * side panel is refused (#707) or opened but never drawn (#690), without
 * stacking windows or touching Firefox's badge path.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_ORIGIN_GUARD } from "@bramble/permissions/blocklist";
import {
  reportSurfacePresence,
  SURFACE_PRESENCE_CHANNEL,
  type SurfacePresenceChannel,
  type SurfacePresenceMessage,
} from "@bramble/wallet-protocol/surface-presence";
import type { ApprovalSurfaceBrowser } from "../../../apps/extension/src/background/approvals/approval-surface";
import { createApprovalSurfaceOpener } from "../../../apps/extension/src/background/approvals/approval-surface";
import {
  createBrowserSurfaceFallback,
  createSurfaceFallback,
  type SurfaceFallbackBrowser,
} from "../../../apps/extension/src/background/approvals/approval-surface-fallback";

const ORIGIN = "https://dapp.example";
const SENDER = { id: "extension-id", tab: { id: 42, windowId: 7 }, url: `${ORIGIN}/app` };
const connect = () => ({ origin: ORIGIN, type: "wallet.requestAccounts" });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type Created = { readonly type: string; readonly url: string };

/**
 * A browser with a scriptable window API, a presence channel whose probe can
 * be answered (or not), and a timer the test fires by hand.
 */
const harness = (
  options: { readonly answerProbe?: boolean; readonly noChannel?: boolean } = {},
) => {
  const created: Created[] = [];
  const focused: number[] = [];
  const closedWindows = new Set<number>();
  let nextId = 100;
  const timers: (() => void)[] = [];
  const channels: { closed: boolean }[] = [];
  const windows: SurfaceFallbackBrowser = {
    runtime: { getURL: (path) => `chrome-extension://id/${path}` },
    windows: {
      async create(details) {
        created.push({ type: details.type, url: details.url });
        nextId += 1;
        return { id: nextId };
      },
      async update(windowId) {
        if (closedWindows.has(windowId)) {
          throw new Error("No window with id");
        }
        focused.push(windowId);
      },
    },
  };
  const channel = (): SurfacePresenceChannel | null => {
    if (options.noChannel) {
      return null;
    }
    const listeners = new Set<(event: { readonly data: unknown }) => void>();
    const state = { closed: false };
    channels.push(state);
    return {
      addEventListener: (_type, listener) => listeners.add(listener),
      close: () => {
        state.closed = true;
      },
      postMessage: (message: SurfacePresenceMessage) => {
        if (message.type === "probe" && options.answerProbe) {
          queueMicrotask(() => {
            for (const listener of listeners) {
              listener({ data: { type: "visible" } });
            }
          });
        }
      },
      removeEventListener: (_type, listener) => listeners.delete(listener),
    };
  };
  const fallback = createSurfaceFallback({
    browser: windows,
    channel,
    schedule: (onElapsed) => {
      timers.push(onElapsed);
      return () => {
        const at = timers.indexOf(onElapsed);
        if (at >= 0) {
          timers.splice(at, 1);
        }
      };
    },
  });
  const fireTimers = () => {
    for (const fire of timers.splice(0)) {
      fire();
    }
  };
  return { channels, closedWindows, created, fallback, fireTimers, focused };
};

const chromium = (open: () => Promise<void>): ApprovalSurfaceBrowser => ({
  sidePanel: { open },
});

const openFrom = (
  browser: ApprovalSurfaceBrowser,
  fallback: ReturnType<typeof harness>["fallback"],
  preference: "popup" | "side-panel" = "side-panel",
) =>
  createApprovalSurfaceOpener({
    browser,
    extensionId: "extension-id",
    fallback,
    guard: DEFAULT_ORIGIN_GUARD,
    now: () => 0,
    preference: () => preference,
  })(connect(), SENDER);

describe("approval surface window fallback", () => {
  test("opens the wallet window when the panel is refused for an expired gesture (#707)", async () => {
    const h = harness();
    openFrom(
      chromium(async () => {
        throw new Error("sidePanel.open() may only be called in response to a user gesture.");
      }),
      h.fallback,
    );
    await flush();

    expect(h.created).toEqual([{ type: "popup", url: "chrome-extension://id/sidepanel.html" }]);
    expect(h.channels).toEqual([]);
  });

  test("opens the wallet window when the panel resolves but no page becomes visible (#690)", async () => {
    const h = harness({ answerProbe: false });
    openFrom(
      chromium(async () => undefined),
      h.fallback,
    );
    await flush();
    expect(h.created).toEqual([]);

    h.fireTimers();
    await flush();

    expect(h.created).toEqual([{ type: "popup", url: "chrome-extension://id/sidepanel.html" }]);
    expect(h.channels).toEqual([{ closed: true }]);
  });

  test("opens nothing more when a wallet page reports itself visible", async () => {
    const h = harness({ answerProbe: true });
    openFrom(
      chromium(async () => undefined),
      h.fallback,
    );
    await flush();
    h.fireTimers();
    await flush();

    expect(h.created).toEqual([]);
    expect(h.channels).toEqual([{ closed: true }]);
  });

  test("assumes the panel is shown when presence cannot be checked", async () => {
    const h = harness({ noChannel: true });
    openFrom(
      chromium(async () => undefined),
      h.fallback,
    );
    await flush();

    expect(h.created).toEqual([]);
  });

  test("focuses the existing window instead of stacking a new one", async () => {
    const h = harness();
    await h.fallback?.open();
    await h.fallback?.open();

    expect(h.created).toHaveLength(1);
    expect(h.focused).toEqual([101]);
  });

  test("opens a fresh window after the user closed the previous one", async () => {
    const h = harness();
    await h.fallback?.open();
    h.closedWindows.add(101);
    await h.fallback?.open();

    expect(h.created).toHaveLength(2);
    expect(h.focused).toEqual([]);
  });

  test("shares one window between requests that arrive together", async () => {
    const h = harness();
    await Promise.all([h.fallback?.open(), h.fallback?.open()]);

    expect(h.created).toHaveLength(1);
  });

  test("falls back to the window when the popup and then the panel are refused", async () => {
    const h = harness();
    openFrom(
      {
        action: {
          openPopup: async () => {
            throw new Error("no popup");
          },
        },
        sidePanel: {
          open: async () => {
            throw new Error("no gesture");
          },
        },
      },
      h.fallback,
      "popup",
    );
    await flush();

    expect(h.created).toHaveLength(1);
  });

  test("leaves Firefox's sidebar path alone", async () => {
    const h = harness();
    openFrom(
      {
        sidebarAction: {
          open: async () => {
            throw new Error("sidebarAction.open may only be called from a user input handler");
          },
        },
      },
      h.fallback,
    );
    await flush();

    expect(h.created).toEqual([]);
  });

  test("never opens a window for a blocked origin or a cooling-down tab", async () => {
    const h = harness();
    const refuse = chromium(async () => {
      throw new Error("no gesture");
    });
    const opener = createApprovalSurfaceOpener({
      browser: refuse,
      extensionId: "extension-id",
      fallback: h.fallback,
      guard: { ...DEFAULT_ORIGIN_GUARD, isBlocked: () => true },
      now: () => 0,
      preference: () => "side-panel",
    });
    opener(connect(), SENDER);
    await flush();
    expect(h.created).toEqual([]);

    const repeat = createApprovalSurfaceOpener({
      browser: refuse,
      extensionId: "extension-id",
      fallback: h.fallback,
      guard: DEFAULT_ORIGIN_GUARD,
      now: () => 0,
      preference: () => "side-panel",
    });
    repeat(connect(), SENDER);
    repeat(connect(), SENDER);
    await flush();
    expect(h.created).toHaveLength(1);
  });

  test("is unavailable without a window API, keeping earlier behavior", () => {
    const missing = createSurfaceFallback({
      browser: { runtime: { getURL: (path) => path } },
      channel: () => null,
      schedule: () => () => undefined,
    });

    expect(missing).toBeUndefined();
  });

  test("production wiring finds a visible page over a real BroadcastChannel", async () => {
    const created: string[] = [];
    const fallback = createBrowserSurfaceFallback({
      runtime: { getURL: (path) => path },
      windows: {
        async create(details) {
          created.push(details.url);
          return { id: 1 };
        },
        async update() {},
      },
    });
    const pageChannel = new BroadcastChannel(SURFACE_PRESENCE_CHANNEL);
    reportSurfacePresence(pageChannel, {
      addEventListener: () => undefined,
      visibilityState: "visible",
    });
    try {
      await fallback?.confirm();
    } finally {
      pageChannel.close();
    }

    expect(created).toEqual([]);
    expect(createBrowserSurfaceFallback(undefined)).toBeUndefined();
  });

  test("finds the wallet window again after the worker restarts (#764 review)", async () => {
    const browser = restartableBrowser();
    await fallbackFor(browser)?.open();
    expect(browser.created).toHaveLength(1);

    // A suspended worker starts over with no memory of the window it opened.
    await fallbackFor(browser)?.open();

    expect(browser.created).toHaveLength(1);
    expect(browser.focused).toEqual([1]);
  });

  test("does not mistake the options tab for the wallet window", async () => {
    const browser = restartableBrowser();
    browser.open.set(9, "normal");
    await fallbackFor(browser)?.open();

    expect(browser.created).toHaveLength(1);
    expect(browser.focused).toEqual([]);
  });

  test("does not reuse a popup showing another extension page", async () => {
    const browser = restartableBrowser();
    browser.foreign.set(8, "chrome-extension://id/ledger-grant.html");
    await fallbackFor(browser)?.open();

    expect(browser.created).toHaveLength(1);
    expect(browser.focused).toEqual([]);
  });

  test("opens a fresh window when the remembered one was closed while the worker slept", async () => {
    const browser = restartableBrowser();
    await fallbackFor(browser)?.open();
    browser.open.delete(1);
    await fallbackFor(browser)?.open();

    expect(browser.created).toHaveLength(2);
  });
});

/**
 * Browser state that outlives any one fallback instance, as a real window
 * outlives the service worker that opened it.
 */
const restartableBrowser = () => {
  const url = "chrome-extension://id/sidepanel.html";
  const open = new Map<number, string>();
  // Popup windows showing some other extension page, such as the Ledger grant.
  const foreign = new Map<number, string>();
  const created: number[] = [];
  const focused: number[] = [];
  const browser: SurfaceFallbackBrowser = {
    runtime: {
      getContexts: async () => [
        ...[...open.keys()].map((windowId) => ({ documentUrl: `${url}#home`, windowId })),
        ...[...foreign].map(([windowId, documentUrl]) => ({ documentUrl, windowId })),
      ],
      getURL: (path) => `chrome-extension://id/${path}`,
    },
    windows: {
      async create() {
        const id = created.length + 1;
        created.push(id);
        open.set(id, "popup");
        return { id };
      },
      async get(windowId) {
        const type = foreign.has(windowId) ? "popup" : open.get(windowId);
        if (!type) {
          throw new Error("No window with id");
        }
        return { type };
      },
      async update(windowId) {
        if (!open.has(windowId) && !foreign.has(windowId)) {
          throw new Error("No window with id");
        }
        focused.push(windowId);
      },
    },
  };
  return { browser, created, focused, foreign, open };
};

const fallbackFor = ({ browser }: ReturnType<typeof restartableBrowser>) =>
  createSurfaceFallback({ browser, channel: () => null, schedule: () => () => undefined });
