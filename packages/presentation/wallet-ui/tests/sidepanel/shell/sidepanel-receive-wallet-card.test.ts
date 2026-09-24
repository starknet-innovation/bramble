/**
 * Receive shows the plain Starknet address first — as a visible string and as
 * the default QR payload — and offers the Bramble contact card as a second
 * choice only once it is complete. A slow or failed coordination-key
 * derivation therefore never blocks receiving, and a partial card is never
 * offered (spec item 3).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
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

const qrLabel = (app: HTMLElement): string | null =>
  app.querySelector("[data-receive-qr] svg")?.getAttribute("aria-label") ?? null;

const option = (app: HTMLElement, payload: "address" | "card"): HTMLButtonElement => {
  const found = app.querySelector<HTMLButtonElement>(`[data-receive-payload="${payload}"]`);
  if (!found) {
    throw new Error(`missing ${payload} option`);
  }
  return found;
};

describe("Receive address and wallet card", () => {
  test("paints the address QR and the full address before any derivation", () => {
    const app = render();

    expect(qrLabel(app)).toBe("QR code for your Starknet address");
    expect(app.querySelector<HTMLElement>("[data-receive-qr]")?.dataset["qrPayload"]).toBe(
      "address",
    );
    expect(app.querySelector("[data-receive-address-text]")?.textContent).toBe(account.address);
    // The network is named once, by the header pill — not again under the address.
    expect(app.querySelector(".receive-network")).toBeNull();
    expect(option(app, "address").getAttribute("aria-pressed")).toBe("true");
    expect(option(app, "card").disabled).toBe(true);
    expect(app.querySelector<HTMLButtonElement>("[data-wallet-card-copy]")?.disabled).toBe(true);
  });

  test("offers the contact card as a switchable second payload once it is complete", async () => {
    const app = render();
    const nostrPublicKey = "11".repeat(32);
    bindReceiveWalletCard({
      app,
      render: async () => undefined,
      wallet: { loadNostrPublicKey: async () => nostrPublicKey } as unknown as SidepanelWallet,
    });
    await settle();

    const card = app.querySelector<HTMLElement>("[data-receive-wallet-card]");
    const copy = app.querySelector<HTMLButtonElement>("[data-wallet-card-copy]");
    expect(card?.dataset["walletCardState"]).toBe("ready");
    expect(copy?.disabled).toBe(false);
    expect(copy?.dataset["copy"]).toContain(nostrPublicKey);
    // Becoming ready does not hijack the QR the user is already looking at.
    expect(qrLabel(app)).toBe("QR code for your Starknet address");
    expect(option(app, "card").disabled).toBe(false);

    option(app, "card").click();
    expect(qrLabel(app)).toBe("QR code for wallet contact card");
    expect(app.querySelector<HTMLElement>("[data-receive-qr]")?.dataset["qrPayload"]).toBe("card");
    expect(option(app, "card").getAttribute("aria-pressed")).toBe("true");
    expect(option(app, "address").getAttribute("aria-pressed")).toBe("false");

    option(app, "address").click();
    expect(qrLabel(app)).toBe("QR code for your Starknet address");
    expect(option(app, "address").getAttribute("aria-pressed")).toBe("true");
    expect(app.querySelector("[data-nostr-key-value]")?.hasAttribute("hidden")).toBe(false);
    expect(app.querySelector("[data-nostr-key-status]")?.hasAttribute("hidden")).toBe(true);
  });

  test("keeps the address QR and withdraws the card choice when derivation is unavailable", async () => {
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
    expect(qrLabel(app)).toBe("QR code for your Starknet address");
    expect(app.querySelector<HTMLElement>("[data-receive-payload-switch]")?.hidden).toBe(true);
    expect(app.querySelector<HTMLButtonElement>("[data-wallet-card-copy]")?.hidden).toBe(true);
    expect(app.querySelector("[data-nostr-key-status]")?.textContent).toContain(
      "Share the account address instead",
    );
    expect(app.querySelector("[data-nostr-key-status]")?.hasAttribute("hidden")).toBe(false);
    expect(app.querySelector("[data-nostr-key-value]")?.hasAttribute("hidden")).toBe(true);
  });

  test("renders an address-only card with no switch for accounts without a signer key", () => {
    document.body.replaceChildren();
    const html = receiveAddressView({
      address: account.address,
      copyLabel: "Copy address",
      hint: "Multisig.",
      networkId: account.networkId,
    });
    expect(html).toContain("QR code for your Starknet address");
    expect(html).not.toContain("data-receive-payload-switch");
    expect(html).toContain(account.address);
  });

  test("the address itself is the copy control, marked as one", () => {
    // Receiving is: show a QR, show the address, let it be copied. The copy
    // button that used to sit below is the address row now, so what you tap
    // and what you get are the same thing.
    const app = render();
    const control = app.querySelector<HTMLButtonElement>("button.receive-address-copy");

    expect(control?.dataset["copy"]).toBe(account.address);
    expect(control?.getAttribute("aria-label")).toBe("Copy account address");
    expect(control?.querySelector("[data-receive-address-text]")?.textContent).toBe(
      account.address,
    );
    // The label names the action; the address is the button's description, so
    // assistive tech hears what will be copied rather than only "Copy".
    expect(control?.getAttribute("aria-describedby")).toBe("receive-address-text");
    expect(control?.querySelector("#receive-address-text")?.textContent).toBe(account.address);
    expect(control?.querySelector(".receive-address-copy-mark")).not.toBeNull();
  });

  test("puts the address back on the QR when Pro closes", async () => {
    // Pro on, card selected, Pro off: the payload switch is gone, so the QR must
    // not stay on a payload the user can no longer see or change.
    const app = render();
    bindReceiveWalletCard({
      app,
      render: async () => undefined,
      wallet: { loadNostrPublicKey: async () => "11".repeat(32) } as unknown as SidepanelWallet,
    });
    await settle();
    const pro = app.querySelector<HTMLButtonElement>("#receive-pro");
    const qr = app.querySelector<HTMLElement>("[data-receive-qr]");

    pro?.click();
    app.querySelector<HTMLButtonElement>('[data-receive-payload="card"]')?.click();
    expect(qr?.dataset["qrPayload"]).toBe("card");

    pro?.click();
    expect(qr?.dataset["qrPayload"]).toBe("address");
    expect(qrLabel(app)).toBe("QR code for your Starknet address");
    expect(
      app.querySelector('[data-receive-payload="address"]')?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  test("keeps the contact card and the keys behind the Pro switch", () => {
    const app = render();
    bindReceiveWalletCard({
      app,
      render: async () => undefined,
      wallet: { loadNostrPublicKey: async () => "11".repeat(32) } as unknown as SidepanelWallet,
    });

    const pro = app.querySelector<HTMLButtonElement>("#receive-pro");
    const fields = app.querySelector<HTMLElement>("#receive-pro-fields");
    expect(pro?.getAttribute("aria-checked")).toBe("false");
    expect(fields?.hasAttribute("hidden")).toBe(true);
    // The QR and the address stay out in front of it.
    expect(app.querySelector("[data-receive-qr]")).not.toBeNull();
    expect(app.querySelector("button.receive-address-copy")).not.toBeNull();
    // The card switch and the keys live inside, so they are there when asked for.
    expect(fields?.querySelector("[data-receive-payload-switch]")).not.toBeNull();
    expect(fields?.querySelector("[data-nostr-key-row]")).not.toBeNull();

    pro?.click();
    expect(pro?.getAttribute("aria-checked")).toBe("true");
    expect(fields?.hasAttribute("hidden")).toBe(false);

    pro?.click();
    expect(fields?.hasAttribute("hidden")).toBe(true);
  });
});
