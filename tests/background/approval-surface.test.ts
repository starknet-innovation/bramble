/**
 * Approval-surface tests cover proactive wallet opening without request mutation.
 */
import { describe, expect, test } from "bun:test";
import {
  configureApprovalSurface,
  requestApprovalSurface,
} from "../../src/background/approval-surface";

describe("approval surface", () => {
  test("opens the sender tab immediately for approval-capable dapp messages", async () => {
    const opened: { tabId: number }[] = [];
    requestApprovalSurface(
      {
        sidePanel: {
          async open(options) {
            opened.push(options);
          },
        },
      },
      "side-panel",
      "extension-id",
      { origin: "https://dapp.example", type: "wallet.requestAccounts" },
      {
        id: "extension-id",
        tab: { id: 42, windowId: 7 },
        url: "https://dapp.example/app",
      },
    );

    expect(opened).toEqual([{ tabId: 42 }]);
  });

  test("opens immediately for every STRK20 private disclosure request", () => {
    const opened: number[] = [];
    for (const type of [
      "wallet.strk20Balances",
      "wallet.strk20PrepareInvoke",
      "wallet.strk20SubaccountCommitment",
    ]) {
      requestApprovalSurface(
        {
          sidePanel: {
            async open({ tabId }) {
              opened.push(tabId);
            },
          },
        },
        "side-panel",
        "extension-id",
        { type },
        {
          id: "extension-id",
          tab: { id: 42 },
          url: "https://dapp.example/app",
        },
      );
    }

    expect(opened).toEqual([42, 42, 42]);
  });

  test("does not open for non-approval messages or untrusted senders", () => {
    const opened: { tabId: number }[] = [];
    const surface = {
      sidePanel: {
        async open(options: { readonly tabId: number }) {
          opened.push(options);
        },
      },
    };
    requestApprovalSurface(
      surface,
      "side-panel",
      "extension-id",
      { type: "wallet.getChainId" },
      {
        id: "extension-id",
        tab: { id: 42 },
        url: "https://dapp.example/app",
      },
    );
    requestApprovalSurface(
      surface,
      "side-panel",
      "extension-id",
      { type: "wallet.requestAccounts" },
      {
        id: "other-extension",
        tab: { id: 42 },
        url: "https://dapp.example/app",
      },
    );
    requestApprovalSurface(
      surface,
      "side-panel",
      "extension-id",
      { type: "wallet.requestAccounts" },
      {
        id: "extension-id",
        url: "chrome-extension://extension-id/sidepanel.html",
      },
    );

    expect(opened).toEqual([]);
  });

  test("does not open for silent account reconnects", () => {
    const opened: { tabId: number }[] = [];
    requestApprovalSurface(
      {
        sidePanel: {
          async open(options) {
            opened.push(options);
          },
        },
      },
      "side-panel",
      "extension-id",
      { silent: true, type: "wallet.requestAccounts" },
      {
        id: "extension-id",
        tab: { id: 42 },
        url: "https://dapp.example/app",
      },
    );

    expect(opened).toEqual([]);
  });

  test("keeps wallet requests alive when Chrome refuses to open the panel", async () => {
    requestApprovalSurface(
      {
        sidePanel: {
          async open() {
            throw new Error("user gesture expired");
          },
        },
      },
      "side-panel",
      "extension-id",
      { type: "wallet.signTypedData" },
      { id: "extension-id", tab: { id: 9 }, url: "https://dapp.example" },
    );

    await Promise.resolve();
  });

  test("opens the action popup in the sender window when that surface is preferred", () => {
    const opened: { readonly windowId?: number }[] = [];
    requestApprovalSurface(
      {
        action: {
          async openPopup(options) {
            opened.push(options ?? {});
          },
        },
      },
      "popup",
      "extension-id",
      { type: "wallet.requestAccounts" },
      {
        id: "extension-id",
        tab: { id: 42, windowId: 7 },
        url: "https://dapp.example/app",
      },
    );

    expect(opened).toEqual([{ windowId: 7 }]);
  });

  test("falls back to the side panel when the preferred popup cannot open", async () => {
    const opened: number[] = [];
    requestApprovalSurface(
      {
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
      "popup",
      "extension-id",
      { type: "wallet.requestAccounts" },
      {
        id: "extension-id",
        tab: { id: 42, windowId: 7 },
        url: "https://dapp.example/app",
      },
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(opened).toEqual([42]);
  });

  test("keeps the request queued when both preferred surfaces reject", async () => {
    requestApprovalSurface(
      {
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
      "popup",
      "extension-id",
      { type: "wallet.requestAccounts" },
      {
        id: "extension-id",
        tab: { id: 42 },
        url: "https://dapp.example/app",
      },
    );

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
