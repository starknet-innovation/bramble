/** Participant selection preserves its origin and accepts only resolved public signer data. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { canonicalAddress } from "@bramble/wallet-model/networks";
import { walletContactCard } from "@bramble/wallet-model/preferences";
import { multisigDeployFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-deploy-view";
import { multisigSignersFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-management-views";
import type { MultisigUiDeps } from "../../../../src/sidepanel/journeys/multisig/multisig-ui";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flushMultisigUi as flush,
  mountMultisigUi as mount,
  makeMultisigUiClient as testClient,
} from "../../../support/multisig-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

describe("multisig participant selection", () => {
  test("resolves an account address and returns to the unchanged deployment setup", async () => {
    const fixture = await makeArgentMultisigFixture();
    const signer = fixture.status.accounts[0];
    if (!signer) throw new Error("signer fixture unavailable");
    const requests: unknown[] = [];
    const client = await testClient({
      resolveSigner: async (address, networkId) => {
        requests.push({ address, networkId });
        return { accountContractType: "argent", address, publicKeyX: "0x789" };
      },
    });
    const app = mount(
      multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences()),
      client,
      fixture.status,
    );
    const name = app.querySelector<HTMLInputElement>('input[name="name"]');
    if (!name) throw new Error("deployment name unavailable");
    name.value = "Operations multisig";
    app.querySelector<HTMLButtonElement>("[data-open-participant-picker]")?.click();
    const address = app.querySelector<HTMLInputElement>("[data-participant-address-input]");
    if (!address) throw new Error("participant address unavailable");
    address.value = "0xabc";
    app.querySelector<HTMLButtonElement>("[data-confirm-participant]")?.click();
    await flush();

    expect(requests).toEqual([{ address: "0xabc", networkId: "SN_MAIN" }]);
    expect(app.querySelector<HTMLElement>("[data-participant-screen]")?.hidden).toBe(true);
    expect(app.querySelector<HTMLElement>("[data-participant-origin]")?.hidden).toBe(false);
    expect(name.value).toBe("Operations multisig");
    expect(app.querySelector<HTMLInputElement>('input[name="signerPublicKeys"]')?.value).toBe(
      `${signer.publicKeyX} 0x789`,
    );
    // The added row names the resolved address, and its copy control works
    // although the row was cloned after the shell bound its copy buttons.
    const copied: string[] = [];
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => copied.push(value) },
    });
    const copy = app.querySelector<HTMLButtonElement>(
      '[data-signer-public-key="0x789"] [data-manual-signer-copy]',
    );
    expect(copy?.hidden).toBe(false);
    copy?.click();
    await flush();
    expect(copied).toEqual(["0xabc"]);
  });

  test("a signer change offers the chosen participant's address for copying", async () => {
    const fixture = await makeArgentMultisigFixture();
    const app = mount(
      multisigSignersFlow(
        fixture.status,
        fixture.status.accounts[0] ?? null,
        fixture.view,
        defaultWalletPreferences(),
      ),
      await testClient(),
      fixture.status,
    );
    const form = app.querySelector<HTMLFormElement>('[data-ms-manage="add"]');
    const copy = (): HTMLButtonElement | null | undefined =>
      form?.querySelector<HTMLButtonElement>("[data-participant-selection-copy]");
    expect(copy()?.hidden).toBe(true);

    form?.querySelector<HTMLButtonElement>("[data-open-participant-picker]")?.click();
    const address = app.querySelector<HTMLInputElement>("[data-participant-address-input]");
    if (!address) throw new Error("participant address unavailable");
    address.value = "0xabc";
    app.querySelector<HTMLButtonElement>("[data-confirm-participant]")?.click();
    await flush();
    expect(copy()?.hidden).toBe(false);
    expect(copy()?.dataset["copy"]).toBe("0xabc");

    // A participant given only by public key has no address to copy.
    form?.querySelector<HTMLButtonElement>("[data-open-participant-picker]")?.click();
    app.querySelector<HTMLButtonElement>('[data-participant-method="public-key"]')?.click();
    const key = app.querySelector<HTMLInputElement>("[data-participant-key-input]");
    if (!key) throw new Error("participant key unavailable");
    key.value = "0x999";
    app.querySelector<HTMLButtonElement>("[data-confirm-participant]")?.click();
    await flush();
    expect(copy()?.hidden).toBe(true);
  });

  test("adds and saves one complete wallet-card participant", async () => {
    const fixture = await makeArgentMultisigFixture();
    const signer = fixture.status.accounts[0];
    if (!signer) throw new Error("signer fixture unavailable");
    const saved: unknown[][] = [];
    const app = mount(
      multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences()),
      await testClient(),
      fixture.status,
      {
        wallet: {
          loadStatus: async () => fixture.status,
          saveAddress: async (...values: unknown[]) => {
            saved.push(values);
          },
        } as unknown as MultisigUiDeps["wallet"],
      },
    );
    app.querySelector<HTMLButtonElement>("[data-open-participant-picker]")?.click();
    app.querySelector<HTMLButtonElement>('[data-participant-method="wallet-card"]')?.click();
    const label = app.querySelector<HTMLInputElement>("[data-participant-label-input]");
    const card = app.querySelector<HTMLTextAreaElement>('[name="participantWalletCard"]');
    if (!label || !card) throw new Error("wallet-card participant controls unavailable");
    label.value = "Adrien";
    card.value = walletContactCard({
      address: "0xabc",
      networkId: "SN_MAIN",
      nostrPublicKey: "11".repeat(32),
      publicKeyX: "0x789",
    });
    app.querySelector<HTMLButtonElement>("[data-confirm-participant]")?.click();
    await flush();

    expect(saved).toEqual([
      ["Adrien", canonicalAddress("0xabc"), "SN_MAIN", "0x789", "11".repeat(32)],
    ]);
    expect(app.querySelector<HTMLInputElement>('input[name="signerPublicKeys"]')?.value).toBe(
      `${signer.publicKeyX} 0x789`,
    );
    expect(app.querySelector<HTMLElement>("[data-participant-screen]")?.hidden).toBe(true);
  });

  test("does not save a wallet card rejected by the originating flow", async () => {
    const fixture = await makeArgentMultisigFixture();
    const signer = fixture.status.accounts[0];
    if (!signer) throw new Error("signer fixture unavailable");
    const saved: unknown[][] = [];
    const app = mount(
      multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences()),
      await testClient(),
      fixture.status,
      {
        wallet: {
          loadStatus: async () => fixture.status,
          saveAddress: async (...values: unknown[]) => {
            saved.push(values);
          },
        } as unknown as MultisigUiDeps["wallet"],
      },
    );
    app.querySelector<HTMLButtonElement>("[data-open-participant-picker]")?.click();
    app.querySelector<HTMLButtonElement>('[data-participant-method="wallet-card"]')?.click();
    const label = app.querySelector<HTMLInputElement>("[data-participant-label-input]");
    const card = app.querySelector<HTMLTextAreaElement>('[name="participantWalletCard"]');
    if (!label || !card) throw new Error("wallet-card participant controls unavailable");
    label.value = "Duplicate signer";
    card.value = walletContactCard({
      address: signer.address,
      networkId: "SN_MAIN",
      nostrPublicKey: "11".repeat(32),
      publicKeyX: signer.publicKeyX,
    });
    app.querySelector<HTMLButtonElement>("[data-confirm-participant]")?.click();
    await flush();

    expect(saved).toEqual([]);
    expect(app.querySelector<HTMLElement>("[data-participant-screen]")?.hidden).toBe(false);
    expect(app.querySelector("[data-participant-result]")?.textContent).not.toBe("");
  });

  // Sherlock 258: the address book refuses a card whose keys differ from a
  // saved contact's. That refusal must also keep the card's keys out of the
  // signer set, or the screen reports "nothing saved" while the key is used.
  const refusingWallet = (status: unknown): MultisigUiDeps["wallet"] =>
    ({
      loadStatus: async () => status,
      saveAddress: async () => {
        throw new Error("Contact keys changed");
      },
    }) as unknown as MultisigUiDeps["wallet"];
  const submitCard = async (app: HTMLElement, scope: ParentNode, publicKeyX: string) => {
    scope.querySelector<HTMLButtonElement>("[data-open-participant-picker]")?.click();
    app.querySelector<HTMLButtonElement>('[data-participant-method="wallet-card"]')?.click();
    const label = app.querySelector<HTMLInputElement>("[data-participant-label-input]");
    const card = app.querySelector<HTMLTextAreaElement>('[name="participantWalletCard"]');
    if (!label || !card) throw new Error("wallet-card participant controls unavailable");
    label.value = "Adrien";
    card.value = walletContactCard({
      address: "0xabc",
      networkId: "SN_MAIN",
      nostrPublicKey: "11".repeat(32),
      publicKeyX,
    });
    app.querySelector<HTMLButtonElement>("[data-confirm-participant]")?.click();
    await flush();
  };

  test("a card the address book refuses does not join a new multisig's signers", async () => {
    const fixture = await makeArgentMultisigFixture();
    const signer = fixture.status.accounts[0];
    if (!signer) throw new Error("signer fixture unavailable");
    const app = mount(
      multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences()),
      await testClient(),
      fixture.status,
      { wallet: refusingWallet(fixture.status) },
    );
    await submitCard(app, app, "0x789");

    expect(app.querySelector<HTMLInputElement>('input[name="signerPublicKeys"]')?.value).toBe(
      signer.publicKeyX,
    );
    expect(app.querySelector('[data-signer-public-key="0x789"]')).toBeNull();
    expect(app.querySelector<HTMLElement>("[data-participant-screen]")?.hidden).toBe(false);
    expect(app.querySelector("[data-participant-result]")?.textContent).not.toBe("");
  });

  test("a card the address book refuses is not selected as a new signer", async () => {
    const fixture = await makeArgentMultisigFixture();
    const app = mount(
      multisigSignersFlow(
        fixture.status,
        fixture.status.accounts[0] ?? null,
        fixture.view,
        defaultWalletPreferences(),
      ),
      await testClient(),
      fixture.status,
      { wallet: refusingWallet(fixture.status) },
    );
    const form = app.querySelector<HTMLFormElement>('[data-ms-manage="add"]');
    if (!form) throw new Error("add-signer form unavailable");
    await submitCard(app, form, "0x789");

    expect(form.querySelector<HTMLInputElement>('[name="selectedPublicKey"]')?.value).toBe("");
    expect(form.querySelector<HTMLElement>("[data-participant-selection]")?.hidden).toBe(true);
    expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });
});
