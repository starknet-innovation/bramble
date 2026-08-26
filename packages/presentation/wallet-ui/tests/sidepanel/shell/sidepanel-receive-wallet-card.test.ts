/** Complete Receive cards never expose a partial coordination identity. */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { account } from "@mc-wallet/testkit/sidepanel";
import { receiveAddressView } from "../../../src/sidepanel/journeys/send/receive-view";
import type { SidepanelWallet } from "../../../src/sidepanel/runtime/runtime";
import { bindReceiveWalletCard } from "../../../src/sidepanel/shell/dashboard-bindings";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const render = (): HTMLElement => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.append(
    document.createRange().createContextualFragment(
      receiveAddressView({
        address: account.address,
        copyLabel: "Copy account address",
        eyebrow: "Receive",
        hint: "Share this account.",
        networkId: account.networkId,
        publicKeyX: account.publicKeyX,
      }),
    ),
  );
  document.body.append(app);
  return app;
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("Receive wallet card coordination", () => {
  test("holds the share action until the complete card is ready", async () => {
    const nostrPublicKey = "11".repeat(32);
    const app = render();
    const card = app.querySelector<HTMLElement>("[data-receive-wallet-card]");
    const copy = app.querySelector<HTMLButtonElement>("[data-wallet-card-copy]");

    expect(card?.dataset["walletCardState"]).toBe("preparing");
    expect(copy?.disabled).toBe(true);
    expect(app.querySelector("[data-receive-qr] svg")).toBeNull();

    bindReceiveWalletCard({
      app,
      render: async () => undefined,
      wallet: { loadNostrPublicKey: async () => nostrPublicKey } as unknown as SidepanelWallet,
    });
    await settle();

    expect(card?.dataset["walletCardState"]).toBe("ready");
    expect(copy?.disabled).toBe(false);
    expect(copy?.dataset["copy"]).toContain(nostrPublicKey);
    expect(app.querySelector("[data-receive-qr] svg")).not.toBeNull();
    expect(app.querySelector("[data-nostr-key-value]")?.hasAttribute("hidden")).toBe(false);
  });

  test("falls back explicitly to an address-only QR when derivation is unavailable", async () => {
    const app = render();
    bindReceiveWalletCard({
      app,
      render: async () => undefined,
      wallet: {
        loadNostrPublicKey: async () => Promise.reject(new Error("unavailable")),
      } as unknown as SidepanelWallet,
    });
    await settle();

    expect(
      app.querySelector<HTMLElement>("[data-receive-wallet-card]")?.dataset["walletCardState"],
    ).toBe("unavailable");
    expect(app.querySelector<HTMLButtonElement>("[data-wallet-card-copy]")?.hidden).toBe(true);
    expect(app.querySelector("[data-receive-qr] svg")).not.toBeNull();
    expect(app.querySelector("[data-nostr-key-status]")?.textContent).toContain(
      "Share the account address instead",
    );
  });
});
