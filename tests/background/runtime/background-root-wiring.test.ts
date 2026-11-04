/**
 * Two pieces of background-root wiring moved out of the entrypoint: the
 * extension's own identity, whose origin must come from the runtime and fails
 * closed when it cannot, and wallet event delivery, which reaches the
 * extension's pages and then every tab, one event at a time and in order,
 * skipping whatever cannot receive it.
 */
import { describe, expect, test } from "bun:test";
import type { WalletEventMessage } from "@bramble/wallet-protocol/events";
import { extensionIdentityOf } from "../../../apps/extension/src/background/routing/senders";
import { createWalletEventBroadcast } from "../../../apps/extension/src/background/runtime/event-broadcast";

const accountsChanged: WalletEventMessage = { event: "accountsChanged", type: "wallet.event" };
const approvalsChanged: WalletEventMessage = { event: "approvalsChanged", type: "wallet.event" };

describe("the extension identity", () => {
  test("takes the origin from the runtime's page URL, never from the id", () => {
    // As on Firefox, the id and the page origin are unrelated values. (Bun's
    // URL has no extension schemes, so an https page stands in for one.)
    expect(
      extensionIdentityOf({
        getURL: (path) => `https://5d1e0c3a-0b1f-4c55-9d5e-2f7c8b9a0e11.example/${path}`,
        id: "wallet@bramble",
      }),
    ).toEqual({
      id: "wallet@bramble",
      origin: "https://5d1e0c3a-0b1f-4c55-9d5e-2f7c8b9a0e11.example",
    });
  });

  test("leaves what the runtime cannot give empty, which no sender matches", () => {
    expect(extensionIdentityOf(undefined)).toEqual({ id: "", origin: "" });
    expect(extensionIdentityOf({ id: "extension-id" })).toEqual({ id: "extension-id", origin: "" });
    expect(
      extensionIdentityOf({
        getURL: () => {
          throw new Error("runtime gone");
        },
        id: "extension-id",
      }),
    ).toEqual({ id: "extension-id", origin: "" });
    expect(extensionIdentityOf({ getURL: () => "not a url", id: "extension-id" }).origin).toBe("");
  });
});

describe("wallet event delivery", () => {
  test("reaches the pages, then every tab with an id, in the order raised", async () => {
    const delivered: string[] = [];
    let settle: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const broadcast = createWalletEventBroadcast({
      runtime: {
        id: "extension-id",
        onInstalled: { addListener: () => undefined },
        onMessage: { addListener: () => undefined },
        async sendMessage(event) {
          delivered.push(`pages:${(event as WalletEventMessage).event}`);
          throw new Error("no page is listening");
        },
      },
      tabs: {
        query: async () => [{ id: 1 }, {}, { id: 2 }],
        async sendMessage(tabId, event) {
          delivered.push(`tab ${tabId}:${(event as WalletEventMessage).event}`);
          if (tabId === 1) throw new Error("no content script");
          if ((event as WalletEventMessage).event === "approvalsChanged" && tabId === 2) settle();
        },
      },
    });
    broadcast(accountsChanged);
    broadcast(approvalsChanged);
    await done;
    expect(delivered).toEqual([
      "pages:accountsChanged",
      "tab 1:accountsChanged",
      "tab 2:accountsChanged",
      "pages:approvalsChanged",
      "tab 1:approvalsChanged",
      "tab 2:approvalsChanged",
    ]);
  });

  test("goes nowhere, without failing, outside an extension", () => {
    expect(() => createWalletEventBroadcast(undefined)(accountsChanged)).not.toThrow();
  });
});
