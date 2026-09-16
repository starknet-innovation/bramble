/**
 * Approval-surface tests cover proactive wallet opening without request mutation.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_ORIGIN_GUARD } from "@bramble/permissions/blocklist";
import type { ApprovalSurfaceBrowser } from "../../../apps/extension/src/background/approvals/approval-surface";
import {
  type ApprovalSurfaceDeps,
  bindToolbarActivation,
  configureApprovalSurface,
  createApprovalSurfaceOpener,
  showPendingApprovals,
} from "../../../apps/extension/src/background/approvals/approval-surface";

const ORIGIN = "https://dapp.example";
const TYPED_DATA = {
  domain: { chainId: "SN_MAIN", name: "Test", revision: "1", version: "1" },
  message: { contents: "hi" },
  primaryType: "Mail",
  types: {
    Mail: [{ name: "contents", type: "felt" }],
    StarknetDomain: [
      { name: "name", type: "shortstring" },
      { name: "version", type: "shortstring" },
      { name: "chainId", type: "shortstring" },
    ],
  },
};

const requestAccounts = () => ({ origin: ORIGIN, type: "wallet.requestAccounts" });
const signRequest = () => ({ origin: ORIGIN, type: "wallet.signTypedData", typedData: TYPED_DATA });

// Every test here drives a single message, so a fixed clock is enough; the
// cooldown timing itself is covered in approval-surface-origin-gating.test.ts.
const opener = (deps: Partial<ApprovalSurfaceDeps>) =>
  createApprovalSurfaceOpener({
    browser: undefined,
    extensionId: "extension-id",
    guard: DEFAULT_ORIGIN_GUARD,
    now: () => 0,
    preference: () => "side-panel",
    ...deps,
  });

describe("approval surface", () => {
  test("opens the sender tab immediately for approval-capable dapp messages", async () => {
    const opened: { tabId: number }[] = [];
    opener({
      browser: {
        sidePanel: {
          async open(options) {
            opened.push(options);
          },
        },
      },
    })(requestAccounts(), {
      id: "extension-id",
      tab: { id: 42, windowId: 7 },
      url: "https://dapp.example/app",
    });

    expect(opened).toEqual([{ tabId: 42 }]);
  });

  test("opens immediately for every STRK20 private disclosure request", () => {
    const opened: number[] = [];
    for (const message of [
      { origin: ORIGIN, tokens: [], type: "wallet.strk20Balances" },
      {
        actions: [{ amount: "0x1", recipient: "0x2", token: "0x1", type: "withdraw" }],
        origin: ORIGIN,
        simulate: false,
        type: "wallet.strk20PrepareInvoke",
      },
      { origin: ORIGIN, type: "wallet.strk20Register" },
      { dappName: "Example", origin: ORIGIN, type: "wallet.strk20SubaccountCommitment" },
    ]) {
      opener({
        browser: {
          sidePanel: {
            async open({ tabId }) {
              opened.push(tabId);
            },
          },
        },
      })(message, { id: "extension-id", tab: { id: 42 }, url: `${ORIGIN}/app` });
    }

    expect(opened).toEqual([42, 42, 42, 42]);
  });

  test("does not open for non-approval messages or untrusted senders", () => {
    const opened: { tabId: number }[] = [];
    const open = opener({
      browser: {
        sidePanel: {
          async open(options: { readonly tabId: number }) {
            opened.push(options);
          },
        },
      },
    });
    open(
      { type: "wallet.getChainId" },
      { id: "extension-id", tab: { id: 42 }, url: "https://dapp.example/app" },
    );
    open(requestAccounts(), {
      id: "other-extension",
      tab: { id: 42 },
      url: "https://dapp.example/app",
    });
    open(requestAccounts(), {
      id: "extension-id",
      url: "chrome-extension://extension-id/sidepanel.html",
    });

    expect(opened).toEqual([]);
  });

  test("does not open for silent account reconnects", () => {
    const opened: { tabId: number }[] = [];
    opener({
      browser: {
        sidePanel: {
          async open(options) {
            opened.push(options);
          },
        },
      },
    })(
      { origin: ORIGIN, silent: true, type: "wallet.requestAccounts" },
      { id: "extension-id", tab: { id: 42 }, url: "https://dapp.example/app" },
    );

    expect(opened).toEqual([]);
  });

  test("does not open for a surface-capable type with an invalid payload", () => {
    const opened: number[] = [];
    const open = opener({
      browser: {
        sidePanel: {
          async open({ tabId }) {
            opened.push(tabId);
          },
        },
      },
    });

    open(
      { origin: ORIGIN, type: "wallet.signTypedData", typedData: {} },
      { id: "extension-id", tab: { id: 42 }, url: `${ORIGIN}/app` },
    );
    open(
      { calls: [], origin: ORIGIN, type: "wallet.addInvokeTransaction" },
      { id: "extension-id", tab: { id: 42 }, url: `${ORIGIN}/app` },
    );

    expect(opened).toEqual([]);
  });

  test("keeps wallet requests alive when Chrome refuses to open the panel", async () => {
    opener({
      browser: {
        sidePanel: {
          async open() {
            throw new Error("user gesture expired");
          },
        },
      },
    })(signRequest(), { id: "extension-id", tab: { id: 9 }, url: "https://dapp.example" });

    await Promise.resolve();
  });

  test("opens the action popup in the sender window when that surface is preferred", () => {
    const opened: { readonly windowId?: number }[] = [];
    opener({
      browser: {
        action: {
          async openPopup(options) {
            opened.push(options ?? {});
          },
        },
      },
      preference: () => "popup",
    })(requestAccounts(), {
      id: "extension-id",
      tab: { id: 42, windowId: 7 },
      url: "https://dapp.example/app",
    });

    expect(opened).toEqual([{ windowId: 7 }]);
  });

  test("falls back to the side panel when the preferred popup cannot open", async () => {
    const opened: number[] = [];
    opener({
      browser: {
        action: {
          async openPopup() {
            throw new Error("popup unavailable");
          },
        },
        sidePanel: {
          async open({ tabId }) {
            opened.push(tabId);
          },
        },
      },
      preference: () => "popup",
    })(requestAccounts(), {
      id: "extension-id",
      tab: { id: 42, windowId: 7 },
      url: "https://dapp.example/app",
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(opened).toEqual([42]);
  });

  test("keeps the request queued when both preferred surfaces reject", async () => {
    opener({
      browser: {
        action: {
          async openPopup() {
            throw new Error("popup unavailable");
          },
        },
        sidePanel: {
          async open() {
            throw new Error("panel unavailable");
          },
        },
      },
      preference: () => "popup",
    })(requestAccounts(), { id: "extension-id", tab: { id: 42 }, url: "https://dapp.example/app" });

    await Promise.resolve();
    await Promise.resolve();
  });

  test("configures toolbar activation for each stored surface", async () => {
    const popups: string[] = [];
    const panelBehaviors: boolean[] = [];
    const browser = {
      action: {
        async setPopup({ popup }: { readonly popup: string }) {
          popups.push(popup);
        },
      },
      sidePanel: {
        async open() {},
        async setPanelBehavior({
          openPanelOnActionClick,
        }: {
          readonly openPanelOnActionClick: boolean;
        }) {
          panelBehaviors.push(openPanelOnActionClick);
        },
      },
    };

    await configureApprovalSurface(browser, "popup");
    await configureApprovalSurface(browser, "side-panel");

    expect(popups).toEqual(["popup.html", ""]);
    expect(panelBehaviors).toEqual([false, true]);
  });
});

// Chromium and Firefox expose the same wallet panel under different APIs:
// `sidePanel.open({ tabId })` and `sidebarAction.open()`. These cases pin that
// the wallet reaches the surface on both, and that the toolbar button — which
// Chromium routes through setPanelBehavior and Firefox does not route at all —
// is wired up only where it would otherwise be dead.
describe("panel surface across browsers", () => {
  const dappMessage = { origin: "https://dapp.example", type: "wallet.requestAccounts" } as const;
  const dappSender = {
    id: "extension-id",
    tab: { id: 42, windowId: 7 },
    url: "https://dapp.example/app",
  } as const;

  test("opens the gecko sidebar when no chromium side panel exists", () => {
    let opened = 0;
    opener({
      browser: {
        sidebarAction: {
          async open() {
            opened += 1;
          },
        },
      },
    })(dappMessage, dappSender);

    expect(opened).toBe(1);
  });

  // Chromium exposes both once `browser` aliases `chrome`; opening the sidebar
  // there would move the wallet to the wrong side of the window.
  test("prefers the chromium side panel when a browser offers both", () => {
    const opened: { tabId: number }[] = [];
    let sidebarOpened = 0;
    opener({
      browser: {
        sidePanel: {
          async open(options) {
            opened.push(options);
          },
        },
        sidebarAction: {
          async open() {
            sidebarOpened += 1;
          },
        },
      },
    })(dappMessage, dappSender);

    expect(opened).toEqual([{ tabId: 42 }]);
    expect(sidebarOpened).toBe(0);
  });

  test("falls back from a refused popup to whichever panel API exists", async () => {
    let opened = 0;
    opener({
      browser: {
        action: {
          openPopup: async () => {
            throw new Error("no active window");
          },
        },
        sidebarAction: {
          async open() {
            opened += 1;
          },
        },
      },
      preference: () => "popup",
    })(dappMessage, dappSender);
    await Promise.resolve();
    await Promise.resolve();

    expect(opened).toBe(1);
  });

  test("routes the toolbar button to the sidebar only where the browser has one", () => {
    let opened = 0;
    const listeners: Array<() => void> = [];
    bindToolbarActivation(
      {
        action: { onClicked: { addListener: (listener) => listeners.push(listener) } },
        sidebarAction: {
          async open() {
            opened += 1;
          },
        },
      },
      () => "side-panel",
    );
    expect(listeners).toHaveLength(1);
    listeners[0]?.();
    expect(opened).toBe(1);
  });

  test("leaves the toolbar button alone on a browser with a side panel", () => {
    const listeners: Array<() => void> = [];
    bindToolbarActivation(
      {
        action: { onClicked: { addListener: (listener) => listeners.push(listener) } },
        sidePanel: { open: async () => undefined },
        sidebarAction: { open: async () => undefined },
      },
      () => "side-panel",
    );

    expect(listeners).toEqual([]);
  });

  test("does not open the sidebar from the toolbar when the user chose the popup", () => {
    let opened = 0;
    const listeners: Array<() => void> = [];
    bindToolbarActivation(
      {
        action: { onClicked: { addListener: (listener) => listeners.push(listener) } },
        sidebarAction: {
          async open() {
            opened += 1;
          },
        },
      },
      () => "popup",
    );
    listeners[0]?.();

    expect(opened).toBe(0);
  });
});

// On Firefox this badge is the ONLY signal a dapp is waiting: a
// `runtime.onMessage` handler is not handling a user action, so neither
// `sidebarAction.open` nor (before Firefox 149) `action.openPopup` may run
// from it. Without the badge the user clicks Connect on a dapp and the wallet
// gives no indication at all until the request times out.
describe("pending-approval badge", () => {
  const badge = (): { readonly texts: string[]; readonly browser: ApprovalSurfaceBrowser } => {
    const texts: string[] = [];
    return {
      texts,
      browser: {
        action: {
          setBadgeText: async ({ text }) => {
            texts.push(text);
          },
        },
      },
    };
  };

  test("marks the toolbar with the number waiting", () => {
    const { texts, browser } = badge();
    showPendingApprovals(browser, 1);
    showPendingApprovals(browser, 3);

    expect(texts).toEqual(["1", "3"]);
  });

  test("clears the mark once nothing is waiting", () => {
    const { texts, browser } = badge();
    showPendingApprovals(browser, 0);

    expect(texts).toEqual([""]);
  });

  test("caps the count so the badge stays legible", () => {
    const { texts, browser } = badge();
    showPendingApprovals(browser, 10);

    expect(texts).toEqual(["9+"]);
  });

  test("does nothing on a runtime with no badge API", () => {
    expect(() => showPendingApprovals({}, 2)).not.toThrow();
    expect(() => showPendingApprovals(undefined, 2)).not.toThrow();
  });

  // The call is fire-and-forget, so a missing `.catch` does not throw into the
  // caller — it surfaces later as an unhandled rejection, which is what this
  // watches for. Asserting only "does not throw" passes with no catch at all.
  test("survives a browser that refuses the badge", async () => {
    const rejections: unknown[] = [];
    const observe = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", observe);
    try {
      showPendingApprovals(
        {
          action: {
            setBadgeText: async () => {
              throw new Error("refused");
            },
          },
        },
        1,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      process.off("unhandledRejection", observe);
    }

    expect(rejections).toEqual([]);
  });
});
