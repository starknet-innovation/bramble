/** Participant selection preserves its origin and accepts only resolved public signer data. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@mc-wallet/settings/preferences";
import { canonicalAddress } from "@mc-wallet/wallet-model/networks";
import { walletContactCard } from "@mc-wallet/wallet-model/preferences";
import { multisigDeployFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-deploy-view";
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
});
