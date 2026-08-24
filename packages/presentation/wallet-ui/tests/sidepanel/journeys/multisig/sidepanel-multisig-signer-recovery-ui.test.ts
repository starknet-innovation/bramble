/** DOM coverage for address-only Argent signer recovery. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@mc-wallet/settings/preferences";
import { argentSignerGuid } from "@mc-wallet/starknet/account-contracts";
import { multisigSignersFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-management-views";
import type { MultisigClient } from "../../../../src/sidepanel/journeys/multisig/multisig-runtime";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flushMultisigUi as flush,
  mountMultisigUi as mount,
  makeMultisigUiClient as testClient,
} from "../../../support/multisig-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

describe("Argent signer recovery", () => {
  test("completes an address-only watch from matched local signer identities", async () => {
    const fixture = await makeArgentMultisigFixture();
    const signerPublicKeys = fixture.record.currentConfig?.signerPublicKeys;
    if (!signerPublicKeys) throw new Error("signer config fixture unavailable");
    const { currentConfig: _currentConfig, ...record } = fixture.record;
    let completed: Parameters<MultisigClient["addMultisig"]>[0] | undefined;
    const client = await testClient({
      addMultisig: async (input) => {
        completed = input;
        return fixture.view;
      },
    });
    const app = mount(
      multisigSignersFlow(
        fixture.status,
        fixture.status.accounts[0] ?? null,
        { ...fixture.view, record },
        defaultWalletPreferences(),
      ),
      client,
      fixture.status,
    );

    expect(app.querySelectorAll('input[name="signerPublicKey"][type="hidden"]')).toHaveLength(1);
    expect(app.querySelector("textarea")).toBeNull();
    app.querySelector<HTMLFormElement>("#multisig-complete-config-form")?.requestSubmit();
    await flush();

    expect(completed).toEqual({
      address: fixture.record.address,
      networkId: fixture.record.networkId,
      signerPublicKeys,
    });
  });

  test("rejects a non-member public key at the signer recovery field", async () => {
    const fixture = await makeArgentMultisigFixture();
    const config = fixture.view.config;
    if (!config) throw new Error("multisig config fixture unavailable");
    const { currentConfig: _currentConfig, ...record } = fixture.record;
    let submissions = 0;
    const client = await testClient({
      addMultisig: async () => {
        submissions += 1;
        return fixture.view;
      },
    });
    const app = mount(
      multisigSignersFlow(
        fixture.status,
        fixture.status.accounts[0] ?? null,
        {
          ...fixture.view,
          config: {
            ...config,
            signerGuids: [...config.signerGuids, argentSignerGuid("0x999")],
          },
          record,
        },
        defaultWalletPreferences(),
      ),
      client,
      fixture.status,
    );
    const input = app.querySelector<HTMLInputElement>("[data-signer-key]");
    if (!input) throw new Error("missing signer recovery field");
    input.value = "0x998";
    app.querySelector<HTMLFormElement>("#multisig-complete-config-form")?.requestSubmit();
    await flush();

    expect(submissions).toBe(0);
    expect(input.validationMessage).toBe(
      "This public key is not a current Stark signer for this multisig.",
    );
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.querySelector(".toast.error .toast-copy")).not.toBeNull();
  });
});
