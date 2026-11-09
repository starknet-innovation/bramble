/**
 * The Fund step of multisig creation (QA #807): the minimum it names, the
 * amount "Fund from this wallet" hands to Send, and where the wizard picks up
 * when that send closes.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import type { ArgentMultisigView } from "../../../../src/popup/responses/multisig-responses";
import { deploymentFailureToast } from "../../../../src/sidepanel/journeys/multisig/multisig-deploy-errors";
import { multisigDeployFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-deploy-view";
import type { SendIntent } from "../../../../src/sidepanel/journeys/send/send-model";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flushMultisigUi as flush,
  mountMultisigUi as mount,
  makeMultisigUiClient as testClient,
} from "../../../support/multisig-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

// 0.099244000000000001 STRK: one FRI past what six decimals can show.
const FEE_FRI = "99244000000000001";

const unfundedFixture = async () => {
  const fixture = await makeArgentMultisigFixture();
  const signer = fixture.status.accounts[0];
  if (!signer) throw new Error("signer fixture unavailable");
  const review = {
    ...fixture.deploymentReview,
    fee: { overallFee: FEE_FRI, unit: "FRI" as const },
    feeAffordability: "insufficient" as const,
  };
  return { fixture, review, signer };
};

describe("the multisig Fund step", () => {
  test("names one minimum, rounded up, on the step and in the recovery toast", async () => {
    const { fixture, review, signer } = await unfundedFixture();
    const app = mount(
      multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences()),
      await testClient({ reviewDeployment: async () => review }),
      fixture.status,
    );
    app.querySelector<HTMLFormElement>("#multisig-deploy-form")?.requestSubmit();
    await flush();

    expect(app.querySelector(".multisig-funding-stage")?.textContent).toContain(
      "Send at least 0.099245 STRK to this address. You can close this screen and resume later.",
    );
    expect(deploymentFailureToast("Resources bounds exceed balance (0).", review)).toContain(
      "with at least 0.099245 STRK,",
    );
  });

  test("hands Send the minimum it names, in exact FRI", async () => {
    const { fixture, review, signer } = await unfundedFixture();
    let intent: SendIntent | undefined;
    const app = mount(
      multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences()),
      await testClient({ reviewDeployment: async () => review }),
      fixture.status,
      {
        openFunding: async (next) => {
          intent = next;
        },
      },
    );
    app.querySelector<HTMLFormElement>("#multisig-deploy-form")?.requestSubmit();
    await flush();
    app.querySelector<HTMLButtonElement>("[data-multisig-fund-local]")?.click();
    await flush();

    expect(intent?.amount).toBe("99245000000000000");
    expect(intent?.recipient).toBe(review.address);
  });

  test("returns to Fund, not Approval, when the funding send closes", async () => {
    const { fixture, review, signer } = await unfundedFixture();
    let calls = 0;
    const client = await testClient({
      reviewDeployment: async () => {
        calls += 1;
        return review;
      },
    });
    const openFunding = async (): Promise<void> => undefined;
    const first = mount(
      multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences()),
      client,
      fixture.status,
      { openFunding },
    );
    first.querySelector<HTMLFormElement>("#multisig-deploy-form")?.requestSubmit();
    await flush();
    first.querySelector<HTMLButtonElement>("[data-multisig-fund-local]")?.click();
    await flush();

    // Send closes by re-rendering the wizard for the saved, undeployed setup.
    const saved: ArgentMultisigView = {
      ...fixture.view,
      authorityStatus: "undeployed",
      config: null,
      deployed: false,
      record: {
        ...fixture.record,
        deployment: {
          salt: review.salt,
          signerPublicKeys: review.signerPublicKeys,
          threshold: review.threshold,
        },
      },
    };
    const returned = mount(
      multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences(), saved),
      client,
      fixture.status,
      { openFunding },
    );
    await flush();

    const form = returned.querySelector<HTMLFormElement>("#multisig-deploy-form");
    expect(calls).toBe(2);
    expect(form?.dataset["deploymentStage"]).toBe("fund");
    expect(returned.querySelector(".multisig-funding-stage")).not.toBeNull();

    // The marker is spent: a later visit to the same setup opens on Approval.
    const later = mount(
      multisigDeployFlow(fixture.status, signer, true, defaultWalletPreferences(), saved),
      client,
      fixture.status,
      { openFunding },
    );
    await flush();
    expect(calls).toBe(2);
    expect(
      later.querySelector<HTMLFormElement>("#multisig-deploy-form")?.dataset["deploymentStage"],
    ).toBe("approval");
  });
});
