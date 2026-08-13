/** DOM bindings forward only exact Argent multisig intents, signatures, and calls. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ArgentMultisigIntentPackage } from "../../../../src/popup/responses/multisig-responses";
import type { MultisigClient } from "../../../../src/sidepanel/journeys/multisig/multisig-runtime";
import type { MultisigUiDeps } from "../../../../src/sidepanel/journeys/multisig/multisig-ui";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import { mountMultisigUi } from "../../../support/multisig-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const flush = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
};

const testClient = async (overrides: Partial<MultisigClient> = {}): Promise<MultisigClient> => {
  const fixture = await makeArgentMultisigFixture();
  return {
    addMultisig: async () => fixture.view,
    deployMultisig: async () => ({
      address: fixture.record.address,
      multisig: fixture.view,
      ok: true,
      transactionHash: "0x456",
    }),
    importIntent: async () => ({ intent: fixture.intent }),
    importSignature: async () => ({ intent: fixture.intent }),
    loadBalances: async () => ({ error: "balances unavailable" }),
    loadClassStatus: async () => true,
    loadMultisigs: async () => ({ intents: [fixture.intent], multisigs: [fixture.view] }),
    prepareIntent: async () => ({ intent: fixture.intent }),
    refreshMultisig: async () => fixture.view,
    removeMultisig: async () => undefined,
    reviewDeployment: async () => fixture.deploymentReview,
    signIntent: async () => ({ intent: fixture.intent }),
    submitIntent: async () => ({ intent: fixture.readyIntent, transactionHash: "0x456" }),
    ...overrides,
  };
};

const mount = (
  html: string,
  client: MultisigClient,
  status: Awaited<ReturnType<typeof makeArgentMultisigFixture>>["status"],
): HTMLElement =>
  mountMultisigUi(html, async () => undefined, {
    multisig: client,
    wallet: { loadStatus: async () => status } as MultisigUiDeps["wallet"],
  });

describe("bindMultisigs frozen-intent forms", () => {
  test("registers an existing account with its address and current signer authority", async () => {
    const fixture = await makeArgentMultisigFixture();
    const captured: unknown[] = [];
    const client = await testClient({
      async addMultisig(input) {
        captured.push(input);
        return fixture.view;
      },
    });
    const app = mount(
      `<form id="multisig-add-form">
        <input name="address" value="0x000123" />
        <input name="name" value=" Treasury " />
        <input name="signerAccountId" value="${fixture.status.activeAccountId}" />
        <input name="signerPublicKeys" value="${fixture.status.accounts[0]?.publicKeyX}" />
        <input name="threshold" value="1" />
        <button type="submit">Add</button>
      </form>`,
      client,
      fixture.status,
    );
    app.querySelector<HTMLFormElement>("#multisig-add-form")?.requestSubmit();
    await flush();
    expect(captured).toEqual([
      {
        address: "0x123",
        name: "Treasury",
        networkId: "SN_MAIN",
        signerAccountId: fixture.status.activeAccountId,
        signerPublicKeys: [fixture.status.accounts[0]?.publicKeyX],
        threshold: 1,
      },
    ]);
  });

  test("normalizes public call fields once and prepares the selected account", async () => {
    const fixture = await makeArgentMultisigFixture();
    const captured: unknown[] = [];
    const client = await testClient({
      async prepareIntent(multisigId, calls, summary) {
        captured.push({ calls, multisigId, summary });
        return {
          feeReview: { overallFee: "44", unit: "FRI" },
          intent: fixture.intent,
        };
      },
    });
    const app = mount(
      `<form id="multisig-propose-form" data-multisig-id="${fixture.record.id}">
        <input name="contractAddress" value="0x000DEF" />
        <input name="entrypoint" value=" transfer " />
        <textarea name="calldata">0x0001, 0x02</textarea>
        <input name="summary" value=" Send funds " />
        <button type="submit">Prepare</button>
      </form>`,
      client,
      fixture.status,
    );
    app.querySelector<HTMLFormElement>("#multisig-propose-form")?.requestSubmit();
    await flush();
    expect(captured).toEqual([
      {
        calls: [{ calldata: ["0x1", "0x2"], contractAddress: "0xdef", entrypoint: "transfer" }],
        multisigId: fixture.record.id,
        summary: "Send funds",
      },
    ]);
  });

  test("imports the complete validated intent package without projecting fields", async () => {
    const fixture = await makeArgentMultisigFixture();
    const imported: ArgentMultisigIntentPackage[] = [];
    const client = await testClient({
      async importIntent(intentPackage) {
        imported.push(intentPackage);
        return { intent: fixture.intent };
      },
    });
    const app = mount(
      `<form id="multisig-track-form">
        <textarea name="intentPackage">${JSON.stringify(fixture.intentPackage)}</textarea>
        <button type="submit">Import</button>
      </form>`,
      client,
      fixture.status,
    );
    app.querySelector<HTMLFormElement>("#multisig-track-form")?.requestSubmit();
    await flush();
    expect(imported).toEqual([fixture.intentPackage]);
  });

  test("binds a signature to the frozen intent id and explicitly selected signer", async () => {
    const fixture = await makeArgentMultisigFixture();
    const signed: unknown[] = [];
    const client = await testClient({
      async signIntent(intentId, signerAccountId) {
        signed.push({ intentId, signerAccountId });
        return { intent: fixture.intent };
      },
    });
    const app = mount(
      `<article data-ms-intent="${fixture.intent.id}">
        <select name="signerAccountId"><option value="${fixture.status.activeAccountId}">Signer</option></select>
        <button data-ms-sign="${fixture.intent.id}" type="button">Sign</button>
      </article>`,
      client,
      fixture.status,
    );
    app.querySelector<HTMLButtonElement>("[data-ms-sign]")?.click();
    await flush();
    expect(signed).toEqual([
      { intentId: fixture.intent.id, signerAccountId: fixture.status.activeAccountId },
    ]);
  });
});
