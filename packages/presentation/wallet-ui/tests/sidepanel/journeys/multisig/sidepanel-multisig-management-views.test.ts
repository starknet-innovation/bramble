/** Argent multisig management screens expose guided, bounded account controls. */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { multisigAccountOptions } from "../../../../src/sidepanel/journeys/multisig/multisig-account-options";
import { multisigDeployFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-deploy-view";
import {
  multisigAddFlow,
  multisigReceiveFlow,
  multisigSignersFlow,
  multisigTrackFlow,
} from "../../../../src/sidepanel/journeys/multisig/multisig-management-views";
import { accountLabel } from "../../../../src/sidepanel/shared/parts";
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

  test("does not offer a view-only Braavos account as a funding source", async () => {
    const fixture = await makeArgentMultisigFixture();
    const fundable = fixture.status.accounts[0];
    if (!fundable) throw new Error("fixture account missing");
    const braavos: AccountRef = {
      ...fundable,
      accountContractType: "braavos",
      address: "0xabc",
      deploymentSalt: fundable.publicKeyX,
      id: "SN_MAIN:0xabc",
    };
    const preferences = defaultWalletPreferences();
    const withBoth = multisigDeployFlow(
      { ...fixture.status, accounts: [braavos, fundable] },
      braavos,
      true,
      preferences,
    );
    const funding = withBoth.slice(
      withBoth.indexOf('name="fundingAccountId"'),
      withBoth.indexOf("data-multisig-fund-local"),
    );
    expect(funding).toContain(`value="${fundable.id}"`);
    expect(funding).not.toContain(braavos.id);
    expect(funding).toContain("selected");

    const onlyBraavos = multisigDeployFlow(
      { ...fixture.status, accounts: [braavos] },
      braavos,
      true,
      preferences,
    );
    const emptyFunding = onlyBraavos.slice(
      onlyBraavos.indexOf('name="fundingAccountId"'),
      onlyBraavos.indexOf("data-multisig-fund-local"),
    );
    expect(emptyFunding).not.toContain(braavos.id);
    expect(onlyBraavos).toContain('data-multisig-fund-local type="button" disabled');
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
    expect(multisigTrackFlow(fixture.status, null)).toContain("Select a watched Ready multisig");
    expect(multisigTrackFlow(fixture.status, fixture.view)).toContain('id="multisig-track-form"');

    const options = multisigAccountOptions(
      [fixture.view, { ...fixture.view, config: null }],
      fixture.record.id,
    );
    expect(options).toContain('aria-pressed="true"');
    expect(options).toContain("1 of 1");
    expect(options).toContain("authority unavailable");
  });

  test("every truncated multisig identity carries a copy control for its full value", async () => {
    const fixture = await makeArgentMultisigFixture();
    const account = fixture.status.accounts[0] ?? null;
    const signerKey = fixture.record.currentConfig?.signerPublicKeys[0] ?? "missing";

    // Signers screen: the address receipt row and each roster row's signer key.
    const signers = multisigSignersFlow(fixture.status, account, fixture.view);
    expect(signers).toContain(
      `<dd><code>${accountLabel(fixture.record.address)}</code><button class="icon-button" data-copy="${fixture.record.address}" type="button" aria-label="Copy multisig address"`,
    );
    const roster = signers.slice(
      signers.indexOf('class="multisig-signer-roster"'),
      signers.indexOf("Add participant"),
    );
    expect(roster).toContain(`<span class="option-sub" title="${signerKey}">`);
    expect(roster).toContain(`Key 0x${signerKey.slice(2, 6)}…${signerKey.slice(-4)}`);
    // The signer's shown name (friendly, no user label on this fixture) names the control.
    expect(roster).toMatch(
      new RegExp(
        `<button class="icon-button ghost copy-inline" data-copy="${signerKey}" type="button" aria-label="Copy [^"]+ signer public key"`,
      ),
    );
    // The copy control sits between the identity and the manage disclosure,
    // never inside a summary or form.
    expect(roster.indexOf("copy-inline")).toBeLessThan(
      roster.indexOf('<details class="disclosure multisig-signer-manage">'),
    );

    // Accounts & groups picker: the row stays the open control; the copy
    // trails it on the same line.
    const options = multisigAccountOptions([fixture.view], null);
    expect(options).toContain(
      `<code title="${fixture.record.address}">${accountLabel(fixture.record.address)}</code>`,
    );
    expect(options).toMatch(
      new RegExp(
        `<div class="option-row-line">\\s*<button class="option-row" data-multisig-open="${fixture.record.id}"[\\s\\S]*?</button>\\s*<button class="icon-button ghost copy-inline" data-copy="${fixture.record.address}" type="button" aria-label="Copy Treasury address"`,
      ),
    );

    // Deploy composer: each selected signer's key copies whole beside Remove.
    const deploy = multisigDeployFlow(fixture.status, account, true, defaultWalletPreferences());
    const selected = deploy.slice(
      deploy.indexOf('class="multisig-selected-signer"'),
      deploy.indexOf("Add participant"),
    );
    expect(selected).toContain(`<span class="option-sub" title="${account?.publicKeyX}">`);
    expect(selected).toMatch(
      new RegExp(
        `data-copy="${account?.publicKeyX}" type="button" aria-label="Copy [^"]+ signer public key"`,
      ),
    );
    expect(selected.indexOf("copy-inline")).toBeGreaterThan(-1);
    expect(selected.indexOf("copy-inline")).toBeLessThan(
      selected.indexOf("data-remove-signer-public-key="),
    );
  });
});
