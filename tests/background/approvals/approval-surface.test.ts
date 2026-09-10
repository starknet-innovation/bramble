/**
 * Approval-surface tests cover proactive wallet opening without request mutation.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_ORIGIN_GUARD } from "@bramble/permissions/blocklist";
import {
  type ApprovalSurfaceDeps,
  configureApprovalSurface,
  createApprovalSurfaceOpener,
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
