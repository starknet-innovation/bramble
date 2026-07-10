/**
 * Approval-surface tests cover proactive wallet opening without request mutation.
 */
import { describe, expect, test } from "bun:test";
import { requestApprovalSurface } from "../src/background/approval-surface";

describe("approval surface", () => {
  test("opens the sender tab immediately for approval-capable dapp messages", async () => {
    const opened: { tabId: number }[] = [];
    requestApprovalSurface(
      {
        async open(options) {
          opened.push(options);
        },
      },
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

  test("does not open for non-approval messages or untrusted senders", () => {
    const opened: { tabId: number }[] = [];
    const surface = {
      async open(options: { readonly tabId: number }) {
        opened.push(options);
      },
    };
    requestApprovalSurface(
      surface,
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
      "extension-id",
      { type: "wallet.requestAccounts" },
      {
        id: "extension-id",
        url: "chrome-extension://extension-id/sidepanel.html",
      },
    );

    expect(opened).toEqual([]);
  });

  test("keeps wallet requests alive when Chrome refuses to open the panel", async () => {
    requestApprovalSurface(
      {
        async open() {
          throw new Error("user gesture expired");
        },
      },
      "extension-id",
      { type: "wallet.signTypedData" },
      { id: "extension-id", tab: { id: 9 }, url: "https://dapp.example" },
    );

    await Promise.resolve();
  });
});
