/**
 * The Fund step of multisig creation (QA #807): the minimum it names.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { deploymentFailureToast } from "../../../../src/sidepanel/journeys/multisig/multisig-deploy-errors";
import { multisigDeployFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-deploy-view";
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
      "Send at least 0.099245 STRK",
    );
    expect(deploymentFailureToast("Resources bounds exceed balance (0).", review)).toContain(
      "with at least 0.099245 STRK,",
    );
  });
});
