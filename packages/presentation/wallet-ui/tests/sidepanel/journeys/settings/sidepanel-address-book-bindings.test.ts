/**
 * Address-book binding coverage drives the real form through success and
 * failure so save normalization, status refresh, and retry state stay visible.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { canonicalAddress } from "@bramble/wallet-model/networks";
import { walletContactCard } from "@bramble/wallet-model/preferences";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { bindAddressBook } from "../../../../src/sidepanel/shell/dashboard-bindings";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const status: WalletStatus = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const form = (): HTMLElement => {
  const app = document.createElement("div");
  app.innerHTML = `<form id="address-form">
    <textarea name="walletCard"></textarea>
    <input name="label" value="Treasury" />
    <input name="address" value=" 0x123 " />
    <input name="networkId" value="SN_MAIN" />
    <input name="publicKeyX" />
    <input name="nostrPublicKey" />
    <button type="submit">Save</button>
  </form><p id="address-result"></p>`;
  document.body.append(app);
  return app;
};

describe("bindAddressBook", () => {
  test("normalizes the address and rerenders after a successful save", async () => {
    const app = form();
    const saved: unknown[][] = [];
    let renders = 0;
    bindAddressBook({
      app,
      render: async (nextStatus) => {
        expect(nextStatus).toEqual(status);
        renders += 1;
      },
      wallet: {
        loadStatus: async () => status,
        saveAddress: async (...values: unknown[]) => {
          saved.push(values);
        },
      } as unknown as SidepanelWallet,
    });

    app.querySelector<HTMLFormElement>("form")?.requestSubmit();
    await tick();

    expect(saved).toEqual([["Treasury", "0x123", "SN_MAIN", undefined, undefined]]);
    expect(app.querySelector("#address-result")?.textContent).toBe("Address saved");
    expect(renders).toBe(1);
  });

  test("fills and saves all public identity fields from one wallet card", async () => {
    const app = form();
    const saved: unknown[][] = [];
    bindAddressBook({
      app,
      render: async () => undefined,
      wallet: {
        loadStatus: async () => status,
        saveAddress: async (...values: unknown[]) => {
          saved.push(values);
        },
      } as unknown as SidepanelWallet,
    });
    const walletCard = app.querySelector<HTMLTextAreaElement>('[name="walletCard"]');
    if (!walletCard) throw new Error("wallet-card field unavailable");
    walletCard.value = walletContactCard({
      address: "0xabc",
      networkId: "SN_MAIN",
      nostrPublicKey: "11".repeat(32),
      publicKeyX: "0x789",
    });
    walletCard.dispatchEvent(new Event("change"));
    app.querySelector<HTMLFormElement>("form")?.requestSubmit();
    await tick();

    expect(saved).toEqual([
      ["Treasury", canonicalAddress("0xabc"), "SN_MAIN", "0x789", "11".repeat(32)],
    ]);
  });

  test("surfaces a save failure and restores the submit control", async () => {
    const app = form();
    bindAddressBook({
      app,
      render: async () => undefined,
      wallet: {
        saveAddress: async () => {
          throw new Error("Address service unavailable");
        },
      } as unknown as SidepanelWallet,
    });

    const submit = app.querySelector<HTMLButtonElement>('button[type="submit"]');
    app.querySelector<HTMLFormElement>("form")?.requestSubmit();
    await tick();

    expect(app.querySelector("#address-result")?.textContent).toBe("Address service unavailable");
    expect(submit?.disabled).toBe(false);
  });
});
