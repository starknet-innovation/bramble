/** Terminal and blocked multisig outcomes use familiar wallet feedback. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { multisigDeployFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-deploy-view";
import { multisigDetailFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-views";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  deferredMultisigUi,
  flushMultisigUi,
  makeMultisigUiClient,
  mountMultisigUi,
} from "../../../support/multisig-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

test("keeps Back inside creation and ignores a late deployment review", async () => {
  const fixture = await makeArgentMultisigFixture();
  const signer = fixture.status.accounts[0];
  if (!signer) throw new Error("signer fixture unavailable");
  const pending = deferredMultisigUi<typeof fixture.deploymentReview>();
  const app = mountMultisigUi(
    multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences()),
    await makeMultisigUiClient({ reviewDeployment: () => pending.promise }),
    fixture.status,
  );
  const form = app.querySelector<HTMLFormElement>("#multisig-deploy-form");
  app.querySelector<HTMLButtonElement>("[data-multisig-deploy-continue]")?.click();
  form?.requestSubmit();
  const headerBack = app.querySelector<HTMLButtonElement>(".flow-header [data-nav-back]");
  let escaped = false;
  headerBack?.addEventListener("click", () => {
    escaped = true;
  });
  headerBack?.click();
  expect(form?.dataset["deploymentStage"]).toBe("participants");
  expect(escaped).toBe(false);

  pending.resolve(fixture.deploymentReview);
  await flushMultisigUi();
  expect(form?.dataset["deploymentStage"]).toBe("participants");
});

test("returns from the deployment review to Approval", async () => {
  const fixture = await makeArgentMultisigFixture();
  const signer = fixture.status.accounts[0];
  if (!signer) throw new Error("signer fixture unavailable");
  const app = mountMultisigUi(
    multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences()),
    await makeMultisigUiClient(),
    fixture.status,
  );
  const form = app.querySelector<HTMLFormElement>("#multisig-deploy-form");
  app.querySelector<HTMLButtonElement>("[data-multisig-deploy-continue]")?.click();
  form?.requestSubmit();
  await flushMultisigUi();
  expect(form?.dataset["deploymentStage"]).toBe("deploy");
  app.querySelector<HTMLButtonElement>(".flow-header [data-nav-back]")?.click();
  expect(form?.dataset["deploymentStage"]).toBe("approval");
  expect(app.querySelector("#multisig-deploy-review")?.textContent).toBe("");
});

test("replaces a submitted intent review with the standard success receipt", async () => {
  const fixture = await makeArgentMultisigFixture();
  const html = multisigDetailFlow(
    fixture.status,
    fixture.status.accounts[0] ?? null,
    fixture.view,
    [
      {
        ...fixture.readyIntent,
        broadcastTransactionHash: fixture.readyIntent.prepared.transactionHash,
        state: "submitted",
      },
    ],
    false,
    defaultWalletPreferences(),
    "multisig-detail",
    undefined,
    fixture.readyIntent.id,
  );

  expect(html).toContain('class="send-outcome send-success multisig-intent-success"');
  expect(html).not.toContain('class="multisig-intent-stack"');
  expect(html).not.toContain('class="allowance-list"');
  expect(html).toContain('class="send-success-check"');
  expect(html).toContain("Transaction submitted");
  expect(html).toContain('data-view="activity"');
  expect(html).toContain("View in Activity");
  expect(html).toContain('data-view="multisig-home"');
  expect(html).not.toContain('data-ms-submit="');
  expect(html).not.toContain("Co-signer handoff");
});

test("returns a submitted intent to the top of its receipt", async () => {
  const fixture = await makeArgentMultisigFixture();
  const app = mountMultisigUi(
    multisigDetailFlow(
      fixture.status,
      fixture.status.accounts[0] ?? null,
      fixture.view,
      [fixture.readyIntent],
      false,
      defaultWalletPreferences(),
      "multisig-detail",
      undefined,
      fixture.readyIntent.id,
    ),
    await makeMultisigUiClient(),
    fixture.status,
  );
  document.documentElement.scrollTop = 180;
  document.body.scrollTop = 180;
  app.querySelector<HTMLButtonElement>("[data-ms-submit]")?.click();
  await flushMultisigUi();

  expect(document.documentElement.scrollTop).toBe(0);
  expect(document.body.scrollTop).toBe(0);
});

test("keeps cached signer authority disabled after its refresh fails", async () => {
  const fixture = await makeArgentMultisigFixture();
  const html = multisigDetailFlow(
    fixture.status,
    fixture.status.accounts[0] ?? null,
    fixture.view,
    [fixture.intent],
    true,
    null,
    "multisig-home",
  );

  expect(html).toContain("Signer authority could not be refreshed");
  expect(html).toContain('data-view="multisig-propose" type="button" disabled');
});

test("explains an already-deployed review without exposing the RPC payload", async () => {
  const fixture = await makeArgentMultisigFixture();
  const signer = fixture.status.accounts[0];
  if (!signer) throw new Error("signer fixture unavailable");
  const client = await makeMultisigUiClient({
    reviewDeployment: async () => {
      throw new Error("RPC: starknet_estimateFee: contract already deployed at address 0x123");
    },
  });
  const app = mountMultisigUi(
    multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences()),
    client,
    fixture.status,
  );
  app.querySelector<HTMLFormElement>("#multisig-deploy-form")?.requestSubmit();
  await flushMultisigUi();

  const message =
    "This multisig is already deployed. Open it from Multisigs instead of deploying it again.";
  expect(app.querySelector("#multisig-deploy-result")?.textContent).toBe(message);
  expect(document.querySelector(".toast.error .toast-text")?.textContent).toBe(message);
  expect(document.querySelector(".toast.error .toast-copy")).not.toBeNull();
  expect(app.textContent).not.toContain("starknet_estimateFee");
});

test("opens the deployed account from the final deployment stage", async () => {
  const fixture = await makeArgentMultisigFixture();
  const signer = fixture.status.accounts[0];
  if (!signer) throw new Error("signer fixture unavailable");
  const opened: string[] = [];
  const app = mountMultisigUi(
    multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences()),
    await makeMultisigUiClient(),
    fixture.status,
    { openDetail: (id) => opened.push(id) },
  );
  const form = app.querySelector<HTMLFormElement>("#multisig-deploy-form");
  form?.requestSubmit();
  await flushMultisigUi();
  form?.requestSubmit();
  await flushMultisigUi();

  const action = app.querySelector<HTMLButtonElement>("[data-open-deployed-multisig]");
  expect(action?.textContent).toContain("Go to deployed account");
  action?.click();
  expect(opened).toEqual([fixture.record.id]);
});
