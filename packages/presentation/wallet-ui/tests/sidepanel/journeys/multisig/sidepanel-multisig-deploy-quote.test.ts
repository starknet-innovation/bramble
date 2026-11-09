/**
 * The multisig deployment form quotes beside its approval controls, but only
 * the user's own check moves it off Approval (QA #807: an automatic quote once
 * skipped straight to Fund).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { multisigDeployFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-deploy-view";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  deferredMultisigUi as deferred,
  flushMultisigUi as flush,
  mountMultisigUi as mount,
  makeMultisigUiClient as testClient,
} from "../../../support/multisig-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
describe("multisig deployment quote", () => {
  test("keeps approval visible while address and fee review are prepared", async () => {
    const fixture = await makeArgentMultisigFixture();
    const signer = fixture.status.accounts[0];
    if (!signer) throw new Error("signer fixture unavailable");
    const pending = deferred<typeof fixture.deploymentReview>();
    const app = mount(
      multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences()),
      await testClient({ reviewDeployment: () => pending.promise }),
      fixture.status,
    );
    const form = app.querySelector<HTMLFormElement>("#multisig-deploy-form");
    app.querySelector<HTMLButtonElement>("[data-multisig-deploy-continue]")?.click();
    form?.requestSubmit();
    expect(form?.dataset["deploymentStage"]).toBe("approval");
    expect(app.querySelector("#multisig-deploy-review")?.textContent).toBe("");
    expect(app.querySelector("#multisig-deploy-result")?.textContent).toContain(
      "Preparing exact deployment fee",
    );
    expect(app.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(app.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toContain(
      "Check fee and address",
    );
    pending.resolve(fixture.deploymentReview);
    await flush();
    expect(form?.dataset["deploymentStage"]).toBe("deploy");
  });
  test("holds an automatic quote on Approval until the user checks", async () => {
    const fixture = await makeArgentMultisigFixture();
    const signer = fixture.status.accounts[0];
    if (!signer) throw new Error("signer fixture unavailable");
    let calls = 0;
    const app = mount(
      multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences()),
      await testClient({
        async reviewDeployment() {
          calls += 1;
          return fixture.deploymentReview;
        },
      }),
      fixture.status,
    );
    const form = app.querySelector<HTMLFormElement>("#multisig-deploy-form");
    app.querySelector<HTMLButtonElement>("[data-multisig-deploy-continue]")?.click();
    await new Promise((resolve) => setTimeout(resolve, 450));
    await flush();

    expect(calls).toBe(1);
    expect(form?.dataset["deploymentStage"]).toBe("approval");
    expect(app.querySelector("#multisig-deploy-review")?.textContent).toBe("");
    expect(form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toContain(
      "Check fee and address",
    );
    // The user's check is answered by the held quote, without a second request.
    form?.requestSubmit();
    expect(calls).toBe(1);
    expect(form?.dataset["deploymentStage"]).toBe("deploy");
    expect(app.querySelector("#multisig-deploy-review")?.textContent).toContain(
      "Predicted address",
    );
    expect(app.querySelector("#multisig-deploy-review")?.textContent).toContain(
      "Maximum network fee",
    );
    expect(form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toContain(
      "Deploy multisig",
    );
  });
  test("re-quotes once when a settled approval field is debounced", async () => {
    const fixture = await makeArgentMultisigFixture();
    const signer = fixture.status.accounts[0];
    if (!signer) throw new Error("signer fixture unavailable");
    let calls = 0;
    const app = mount(
      multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences()),
      await testClient({
        async reviewDeployment() {
          calls += 1;
          return fixture.deploymentReview;
        },
      }),
      fixture.status,
    );
    const form = app.querySelector<HTMLFormElement>("#multisig-deploy-form");
    app.querySelector<HTMLButtonElement>("[data-multisig-deploy-continue]")?.click();
    await new Promise((resolve) => setTimeout(resolve, 450));
    const afterContinue = calls;
    expect(afterContinue).toBeGreaterThan(0);
    const salt = form?.querySelector<HTMLInputElement>('input[name="salt"]');
    if (!salt) throw new Error("salt input unavailable");
    for (const value of ["0x1", "0x2", "0x3"]) {
      salt.value = value;
      salt.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(calls).toBe(afterContinue + 1);
    expect(form?.dataset["deploymentStage"]).toBe("approval");
  });
  test("holds the Deploy action busy, then names it, as the quote settles", async () => {
    const fixture = await makeArgentMultisigFixture();
    const signer = fixture.status.accounts[0];
    if (!signer) throw new Error("signer fixture unavailable");
    const pending = deferred<typeof fixture.deploymentReview>();
    const app = mount(
      multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences()),
      await testClient({ reviewDeployment: () => pending.promise }),
      fixture.status,
    );
    const submit = app.querySelector<HTMLButtonElement>('button[type="submit"]');
    app.querySelector<HTMLButtonElement>("[data-multisig-deploy-continue]")?.click();
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(submit?.disabled).toBe(true);
    expect(submit?.textContent).toContain("Check fee and address");
    pending.resolve(fixture.deploymentReview);
    await flush();
    expect(submit?.disabled).toBe(false);
    expect(submit?.textContent).toContain("Check fee and address");
    app.querySelector<HTMLFormElement>("#multisig-deploy-form")?.requestSubmit();
    expect(submit?.textContent).toContain("Deploy multisig");
  });
  test("toasts a failed quote only on an explicit submit, not the auto-quote", async () => {
    const fixture = await makeArgentMultisigFixture();
    const signer = fixture.status.accounts[0];
    if (!signer) throw new Error("signer fixture unavailable");
    let calls = 0;
    const app = mount(
      multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences()),
      await testClient({
        async reviewDeployment() {
          calls += 1;
          throw new Error("deployment review unavailable");
        },
      }),
      fixture.status,
    );
    const form = app.querySelector<HTMLFormElement>("#multisig-deploy-form");
    const submit = app.querySelector<HTMLButtonElement>('button[type="submit"]');
    app.querySelector<HTMLButtonElement>("[data-multisig-deploy-continue]")?.click();
    await new Promise((resolve) => setTimeout(resolve, 450));
    await flush();
    expect(calls).toBeGreaterThan(0);
    expect(document.querySelector(".toast.error")).toBeNull();
    expect(app.querySelector("#multisig-deploy-result")?.textContent).toContain(
      "Deployment review failed",
    );
    expect(submit?.disabled).toBe(false);
    expect(submit?.textContent).toContain("Check fee and address");
    form?.requestSubmit();
    await flush();
    expect(document.querySelector(".toast.error .toast-text")).not.toBeNull();
  });
  test("an auto-quote never enables Deploy while the account class is unchecked", async () => {
    const fixture = await makeArgentMultisigFixture();
    const signer = fixture.status.accounts[0];
    if (!signer) throw new Error("signer fixture unavailable");
    const pending = deferred<typeof fixture.deploymentReview>();
    const app = mount(
      multisigDeployFlow(fixture.status, signer, null, defaultWalletPreferences()),
      await testClient({ reviewDeployment: () => pending.promise }),
      fixture.status,
    );
    const form = app.querySelector<HTMLFormElement>("#multisig-deploy-form");
    const submit = app.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(form?.dataset["classReady"]).not.toBe("true");
    app.querySelector<HTMLButtonElement>("[data-multisig-deploy-continue]")?.click();
    await new Promise((resolve) => setTimeout(resolve, 450));
    pending.resolve(fixture.deploymentReview);
    await flush();
    expect(submit?.disabled).toBe(true);
  });
  test("an automatic quote that needs funding never skips Approval", async () => {
    const fixture = await makeArgentMultisigFixture();
    const signer = fixture.status.accounts[0];
    if (!signer) throw new Error("signer fixture unavailable");
    let calls = 0;
    const app = mount(
      multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences()),
      await testClient({
        async reviewDeployment() {
          calls += 1;
          return { ...fixture.deploymentReview, feeAffordability: "insufficient" };
        },
      }),
      fixture.status,
    );
    const form = app.querySelector<HTMLFormElement>("#multisig-deploy-form");
    const submit = app.querySelector<HTMLButtonElement>('button[type="submit"]');
    app.querySelector<HTMLButtonElement>("[data-multisig-deploy-continue]")?.click();
    await new Promise((resolve) => setTimeout(resolve, 450));
    await flush();

    expect(calls).toBe(1);
    expect(form?.dataset["deploymentStage"]).toBe("approval");
    expect(app.querySelector(".multisig-funding-stage")).toBeNull();
    expect(submit?.hidden).toBe(false);
    expect(submit?.textContent).toContain("Check fee and address");
    form?.requestSubmit();
    expect(form?.dataset["deploymentStage"]).toBe("fund");
    expect(app.querySelector(".multisig-funding-stage")).not.toBeNull();
  });
  test("an edit after the automatic quote retires it before the user checks", async () => {
    const fixture = await makeArgentMultisigFixture();
    const signer = fixture.status.accounts[0];
    if (!signer) throw new Error("signer fixture unavailable");
    const quoted: string[] = [];
    const app = mount(
      multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences()),
      await testClient({
        async reviewDeployment(input) {
          quoted.push(input.salt);
          return { ...fixture.deploymentReview, salt: input.salt };
        },
      }),
      fixture.status,
    );
    const form = app.querySelector<HTMLFormElement>("#multisig-deploy-form");
    app.querySelector<HTMLButtonElement>("[data-multisig-deploy-continue]")?.click();
    await new Promise((resolve) => setTimeout(resolve, 450));
    await flush();
    const salt = form?.querySelector<HTMLInputElement>('input[name="salt"]');
    if (!salt) throw new Error("salt input unavailable");
    salt.value = "0x7";
    salt.dispatchEvent(new Event("input", { bubbles: true }));
    form?.requestSubmit();
    await flush();

    expect(quoted).toEqual(["0x0", "0x7"]);
    expect(form?.dataset["deploymentStage"]).toBe("deploy");
  });
});
