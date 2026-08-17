/** DOM bindings forward only exact Argent multisig intents, signatures, and calls. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@mc-wallet/settings/preferences";
import { buildErc20TransferCall, parseTokenAmount } from "@mc-wallet/starknet/rpc";
import type {
  ArgentMultisigDeploymentReview,
  ArgentMultisigIntentPackage,
} from "../../../../src/popup/responses/multisig-responses";
import { multisigDeployFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-deploy-view";
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
  overrides: Partial<MultisigUiDeps> = {},
): HTMLElement =>
  mountMultisigUi(html, async () => undefined, {
    multisig: client,
    wallet: { loadStatus: async () => status } as MultisigUiDeps["wallet"],
    ...overrides,
  });

describe("bindMultisigs frozen-intent forms", () => {
  test("manages deployment signers as validated rows instead of list text", async () => {
    const fixture = await makeArgentMultisigFixture();
    const primary = fixture.status.accounts[0];
    if (!primary) throw new Error("signer fixture unavailable");
    const secondary = { ...primary, id: `${primary.networkId}:0x456`, publicKeyX: "0x456" };
    const status = { ...fixture.status, accountCount: 2, accounts: [primary, secondary] };
    const app = mount(
      multisigDeployFlow(status, primary, true, defaultWalletPreferences()),
      await testClient(),
      status,
    );

    app.querySelector<HTMLButtonElement>(`[data-deployment-signer="${secondary.id}"]`)?.click();
    expect(app.querySelector<HTMLInputElement>('input[name="signerAccountId"]')?.value).toBe(
      secondary.id,
    );
    expect(
      app.querySelector(`[data-deployment-signer="${secondary.id}"]`)?.getAttribute("aria-pressed"),
    ).toBe("true");

    const addKey = app.querySelector<HTMLButtonElement>(
      `[data-add-signer-public-key="${secondary.publicKeyX}"]`,
    );
    addKey?.click();
    expect(app.querySelector<HTMLInputElement>('input[name="signerPublicKeys"]')?.value).toBe(
      `${primary.publicKeyX} ${secondary.publicKeyX}`,
    );
    expect(app.querySelector("[data-signer-count]")?.textContent).toBe("2 signers");
    expect(addKey?.hidden).toBe(true);

    const threshold = app.querySelector<HTMLInputElement>('input[name="threshold"]');
    if (!threshold) throw new Error("threshold field unavailable");
    threshold.value = "2";
    app
      .querySelector<HTMLButtonElement>(`[data-remove-signer-public-key="${primary.publicKeyX}"]`)
      ?.click();
    expect(app.querySelector<HTMLInputElement>('input[name="signerPublicKeys"]')?.value).toBe(
      secondary.publicKeyX,
    );
    expect(threshold.value).toBe("1");

    const manual = app.querySelector<HTMLInputElement>("[data-manual-signer-public-key]");
    const addManual = app.querySelector<HTMLButtonElement>("[data-add-manual-signer]");
    if (!manual || !addManual) throw new Error("manual signer controls unavailable");
    manual.value = "not-a-key";
    addManual.click();
    expect(app.querySelector("[data-manual-signer-result]")?.textContent).toContain("valid");
    manual.value = "0x999";
    addManual.click();
    expect(app.querySelector<HTMLInputElement>('input[name="signerPublicKeys"]')?.value).toBe(
      `${secondary.publicKeyX} 0x999`,
    );
    expect(app.querySelector("[data-signer-count]")?.textContent).toBe("2 signers");
  });

  test("keeps an unfunded deployment in review instead of offering broadcast", async () => {
    const fixture = await makeArgentMultisigFixture();
    const signer = fixture.status.accounts[0];
    if (!signer) throw new Error("signer fixture unavailable");
    const client = await testClient({
      reviewDeployment: async () => ({
        ...fixture.deploymentReview,
        feeAffordability: "insufficient",
      }),
    });
    const app = mount(
      multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences()),
      client,
      fixture.status,
    );

    app.querySelector<HTMLFormElement>("#multisig-deploy-form")?.requestSubmit();
    await flush();

    expect(app.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toContain(
      "Check funding again",
    );
    expect(app.querySelector("#multisig-deploy-result")?.textContent).toContain(
      "Fund the predicted address",
    );
    expect(app.querySelector(".multisig-deployment-target code")?.textContent).not.toBe(
      fixture.deploymentReview.address,
    );
    expect(
      app.querySelector(".multisig-deployment-target [data-copy]")?.getAttribute("data-copy"),
    ).toBe(fixture.deploymentReview.address);
  });

  test("keeps deployment failures in a copyable toast and resets the review action", async () => {
    const fixture = await makeArgentMultisigFixture();
    const signer = fixture.status.accounts[0];
    if (!signer) throw new Error("signer fixture unavailable");
    const raw = "RPC: starknet_addDeployAccountTransaction: Resources bounds exceed balance (0).";
    const client = await testClient({
      deployMultisig: async () => {
        throw new Error(raw);
      },
    });
    const app = mount(
      multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences()),
      client,
      fixture.status,
    );
    const form = app.querySelector<HTMLFormElement>("#multisig-deploy-form");
    form?.requestSubmit();
    await flush();
    form?.requestSubmit();
    await flush();

    expect(app.querySelector("#multisig-deploy-result")?.textContent).not.toContain("RPC:");
    expect(document.querySelector(".toast.error .toast-text")?.textContent).toContain("Fund 0x");
    expect(document.querySelector(".toast.error .toast-copy")).not.toBeNull();
    expect(app.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toContain(
      "Review deployment",
    );
  });

  test("syncs an existing account from its address and opens the matched account", async () => {
    const fixture = await makeArgentMultisigFixture();
    const captured: unknown[] = [];
    const opened: unknown[] = [];
    const client = await testClient({
      async addMultisig(input) {
        captured.push(input);
        return fixture.view;
      },
    });
    const app = mount(
      `<form id="multisig-add-form">
        <input name="address" value="0x000123" />
        <button type="submit">Add</button>
      </form>`,
      client,
      fixture.status,
      { openDetail: (...input) => opened.push(input) },
    );
    app.querySelector<HTMLFormElement>("#multisig-add-form")?.requestSubmit();
    await flush();
    expect(captured).toEqual([
      {
        address: "0x123",
        networkId: "SN_MAIN",
      },
    ]);
    expect(opened).toEqual([[fixture.record.id, "multisig-home"]]);
  });

  test("normalizes public call fields once and prepares the selected account", async () => {
    const fixture = await makeArgentMultisigFixture();
    const captured: unknown[] = [];
    const opened: unknown[] = [];
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
      `<form data-ms-prepare="contract" data-multisig-id="${fixture.record.id}">
        <input name="contractAddress" value="0x000DEF" />
        <input name="entrypoint" value=" transfer " />
        <textarea name="calldata">0x0001, 0x02</textarea>
        <button type="submit">Prepare</button>
      </form>`,
      client,
      fixture.status,
      { openDetail: (...args) => opened.push(args) },
    );
    app.querySelector<HTMLFormElement>("[data-ms-prepare]")?.requestSubmit();
    await flush();
    expect(captured).toEqual([
      {
        calls: [{ calldata: ["0x1", "0x2"], contractAddress: "0xdef", entrypoint: "transfer" }],
        multisigId: fixture.record.id,
      },
    ]);
    expect(opened).toEqual([[fixture.record.id, "multisig-detail"]]);
  });

  test("builds a token transfer from recipient, asset, and decimal amount fields", async () => {
    const fixture = await makeArgentMultisigFixture();
    const captured: unknown[] = [];
    const client = await testClient({
      async prepareIntent(multisigId, calls) {
        captured.push({ calls, multisigId });
        return { intent: fixture.intent };
      },
    });
    const app = mount(
      `<form data-ms-prepare="transfer" data-multisig-id="${fixture.record.id}">
        <input name="recipient" value="0xabc" />
        <input name="amount" value="1.25" />
        <input name="tokenAddress" value="0xdef" />
        <input name="tokenBalance" value="500" />
        <input name="tokenDecimals" value="2" />
        <input name="tokenPrice" value="2" />
        <button type="submit">Review</button>
      </form>`,
      client,
      fixture.status,
    );
    app.querySelector<HTMLFormElement>("[data-ms-prepare]")?.requestSubmit();
    await flush();
    expect(captured).toEqual([
      {
        calls: [buildErc20TransferCall("0xdef", "0xabc", parseTokenAmount("1.25", 2))],
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
    expect(newest).toContain("What will happen");
    expect(newest).toContain("Risk and recovery");
    expect(newest).toContain("Maximum cost and constraints");
    expect(newest).toContain("Technical details");
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
        authorityAvailable: true,
        canDeploy: false,
        canSign: true,
        data: EMPTY_MULTISIG_PORTFOLIO,
        intents: "<p>Intent panel</p>",
        openCount: 1,
        preferences: null,
        record: fixture.record,
        signerKnown: true,
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
