/** Argent multisig management screens expose guided, bounded account controls. */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { multisigAccountOptions } from "../../../../src/sidepanel/journeys/multisig/multisig-account-options";
import { multisigDeployFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-deploy-view";
import {
  multisigAddFlow,
  multisigReceiveFlow,
  multisigSignersFlow,
  multisigTrackFlow,
} from "../../../../src/sidepanel/journeys/multisig/multisig-management-views";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";

describe("Argent multisig management views", () => {
  test("renders deployment availability and exact constructor inputs", async () => {
    const fixture = await makeArgentMultisigFixture();
    const account = fixture.status.accounts[0] ?? null;

    expect(multisigDeployFlow(fixture.status, null, true)).toContain("No account on");
    expect(multisigDeployFlow(fixture.status, account, false)).toContain("not declared");
    expect(multisigDeployFlow(fixture.status, account, null)).toContain(
      "Checking the pinned class",
    );
    expect(multisigDeployFlow(fixture.status, account, "error")).toContain(
      "Deployment remains disabled",
    );
    const preferences = {
      ...defaultWalletPreferences(),
      addressBook: [
        {
          address: "0x123",
          id: "SN_MAIN:0x123",
          label: "Research treasury",
          networkId: "SN_MAIN" as const,
          publicKeyX: "0x999",
        },
      ],
    };
    const ready = multisigDeployFlow(fixture.status, account, true, preferences);
    expect(ready).toContain('id="multisig-deploy-form"');
    expect(ready).toContain(`value="${account?.publicKeyX}"`);
    expect(ready).not.toContain("multisig-contract-details");
    expect(ready).toContain(`data-deployment-signer="${account?.id}"`);
    expect(ready).toContain('class="option-avatar"');
    expect(ready).toContain('data-participant-key="0x999"');
    expect(ready).toContain("Signer set");
    expect(ready).toContain("Add participant");
    expect(ready).toContain("account address");
    expect(ready).toContain("Public key");
    expect(ready).toContain("Wallet card");
    expect(ready).toContain('name="signerPublicKeys" type="hidden"');
    expect(ready).not.toContain("Space-separated public keys");
    expect(ready).toContain('name="signerAccountId" type="hidden"');
    expect(ready).toContain("Continue to approval");
    expect(ready).toContain("data-nav-back");
    expect(ready).not.toContain("data-multisig-deploy-back");
    expect(ready).toContain("Review deployment");
    expect(ready.match(/data-multisig-deploy-step=/g)).toHaveLength(4);
    expect(ready).toContain("Participants");
    expect(ready).not.toContain("<small>Address</small>");
    expect(ready).not.toContain("<small>Done</small>");

    const saved = multisigDeployFlow(fixture.status, account, true, preferences, {
      ...fixture.view,
      authorityStatus: "undeployed",
      config: null,
      deployed: false,
      record: {
        ...fixture.record,
        deployment: { salt: "0x0", signerPublicKeys: [account?.publicKeyX ?? ""], threshold: 1 },
      },
    });
    expect(saved).toContain('data-deployment-stage="approval"');
    expect(saved).toContain('data-stage="approval" data-state="active" aria-current="step"');
  });

  test("renders setup, live authority, receive, import, and account-picker states", async () => {
    const fixture = await makeArgentMultisigFixture();
    const account = fixture.status.accounts[0] ?? null;

    const setup = multisigAddFlow(fixture.status, account);
    expect(setup).toContain("Create a multisig");
    expect(setup).toContain('class="multisig-setup-options"');
    expect(multisigAddFlow(fixture.status, null)).toContain("No account on");
    expect(multisigSignersFlow(fixture.status, account, null)).toContain("no longer watched");
    expect(multisigSignersFlow(fixture.status, account, fixture.view)).toContain(
      fixture.record.currentConfig?.signerPublicKeys[0] ?? "missing",
    );
    expect(
      multisigSignersFlow(fixture.status, account, {
        ...fixture.view,
        authorityStatus: "network-unavailable",
        config: null,
        deployed: null,
      }),
    ).toContain("Check the network and retry");
    expect(multisigReceiveFlow(fixture.status, null)).toContain("no longer watched");
    expect(multisigReceiveFlow(fixture.status, fixture.view)).toContain(fixture.record.address);
    expect(multisigTrackFlow(fixture.status, null)).toContain("Select a watched Argent multisig");
    expect(multisigTrackFlow(fixture.status, fixture.view)).toContain('id="multisig-track-form"');

    const options = multisigAccountOptions(
      [fixture.view, { ...fixture.view, config: null }],
      fixture.record.id,
    );
    expect(options).toContain('aria-pressed="true"');
    expect(options).toContain("1 of 1");
    expect(options).toContain("authority unavailable");
  });
});
