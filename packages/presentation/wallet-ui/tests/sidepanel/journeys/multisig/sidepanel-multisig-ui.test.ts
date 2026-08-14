/** DOM bindings forward only exact Argent multisig intents, signatures, and calls. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type {
  ArgentMultisigDeploymentReview,
  ArgentMultisigIntentPackage,
} from "../../../../src/popup/responses/multisig-responses";
import {
  EMPTY_MULTISIG_PORTFOLIO,
  multisigPortfolio,
} from "../../../../src/sidepanel/journeys/multisig/multisig-portfolio";
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

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((next) => {
      resolve = next;
    }),
    resolve,
  };
};

const deploymentForm = (signerAccountId: string, publicKey: string): string => `
  <form id="multisig-deploy-form">
    <input name="name" value="Treasury" />
    <input name="signerPublicKeys" value="${publicKey}" />
    <input name="threshold" value="1" />
    <input name="salt" value="0x0" />
    <input name="signerAccountId" value="${signerAccountId}" />
    <div id="multisig-deploy-review"></div>
    <button type="submit">Review deployment</button>
    <p id="multisig-deploy-result"></p>
  </form>`;

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
      async prepareIntent(multisigId, calls) {
        captured.push({ calls, multisigId });
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

  test("discards a deployment review that resolves after the form is edited", async () => {
    const fixture = await makeArgentMultisigFixture();
    const pending = deferred<typeof fixture.deploymentReview>();
    const client = await testClient({ reviewDeployment: () => pending.promise });
    const signer = fixture.status.accounts[0];
    if (!signer) throw new Error("signer fixture unavailable");
    const app = mount(deploymentForm(signer.id, signer.publicKeyX), client, fixture.status);
    const form = app.querySelector<HTMLFormElement>("#multisig-deploy-form");
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    const salt = form?.elements.namedItem("salt");
    if (!(salt instanceof HTMLInputElement)) throw new Error("salt field unavailable");
    salt.value = "0x2";
    salt.dispatchEvent(new Event("input", { bubbles: true }));
    pending.resolve(fixture.deploymentReview);
    await flush();

    expect(app.querySelector("#multisig-deploy-review")?.textContent).toBe("");
    expect(form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    expect(form?.querySelector('button[type="submit"]')?.textContent).toContain(
      "Review deployment",
    );
  });

  test("keeps only the newest deployment review when requests resolve out of order", async () => {
    const fixture = await makeArgentMultisigFixture();
    const pending: ReturnType<typeof deferred<ArgentMultisigDeploymentReview>>[] = [];
    const client = await testClient({
      reviewDeployment: () => {
        const request = deferred<typeof fixture.deploymentReview>();
        pending.push(request);
        return request.promise;
      },
    });
    const signer = fixture.status.accounts[0];
    if (!signer) throw new Error("signer fixture unavailable");
    const app = mount(deploymentForm(signer.id, signer.publicKeyX), client, fixture.status);
    const form = app.querySelector<HTMLFormElement>("#multisig-deploy-form");
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    const salt = form?.elements.namedItem("salt");
    if (!(salt instanceof HTMLInputElement)) throw new Error("salt field unavailable");
    salt.value = "0x2";
    salt.dispatchEvent(new Event("input", { bubbles: true }));
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    pending[1]?.resolve({ ...fixture.deploymentReview, address: "0x999", salt: "0x2" });
    await flush();
    const reviewPanel = app.querySelector<HTMLElement>("#multisig-deploy-review");
    const newest = reviewPanel?.innerHTML;
    expect(newest).toContain("0x999");
    expect(newest).toContain("0x2");
    pending[0]?.resolve(fixture.deploymentReview);
    await flush();

    expect(reviewPanel?.innerHTML).toBe(newest);
    expect(form?.querySelector('button[type="submit"]')?.textContent).toContain(
      "Deploy reviewed account",
    );
  });

  test("links shared-account tabs and supports the standard keyboard order", async () => {
    const fixture = await makeArgentMultisigFixture();
    const client = await testClient();
    const app = mount(
      multisigPortfolio({
        canSign: true,
        data: EMPTY_MULTISIG_PORTFOLIO,
        intents: "<p>Intent panel</p>",
        openCount: 1,
        preferences: null,
        record: fixture.record,
      }),
      client,
      fixture.status,
    );
    const tabs = Array.from(app.querySelectorAll<HTMLButtonElement>("[data-ms-home-tab]"));
    const panels = Array.from(app.querySelectorAll<HTMLElement>("[data-ms-home-panel]"));
    const selectedTab = tabs[1];
    if (!selectedTab) throw new Error("collectibles tab unavailable");
    expect(tabs.map((tab) => tab.getAttribute("aria-controls"))).toEqual(
      panels.map((panel) => panel.id),
    );
    expect(panels.map((panel) => panel.getAttribute("aria-labelledby"))).toEqual(
      tabs.map((tab) => tab.id),
    );
    expect(panels.map((panel) => panel.tabIndex)).toEqual([0, 0, 0]);

    tabs[0]?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(tabs.map((tab) => [tab.getAttribute("aria-selected"), tab.tabIndex])).toEqual([
      ["false", -1],
      ["true", 0],
      ["false", -1],
    ]);
    expect(panels.map((panel) => panel.hidden)).toEqual([true, false, true]);
    expect(document.activeElement).toBe(selectedTab);
  });
});
