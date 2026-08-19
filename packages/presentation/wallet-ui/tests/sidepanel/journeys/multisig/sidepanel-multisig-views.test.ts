/** Argent multisig views expose exact frozen authority and fail closed without freshness. */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@mc-wallet/settings/preferences";
import { UINT128_LIMIT } from "@mc-wallet/wallet-model/networks";
import { multisigAccountOptions } from "../../../../src/sidepanel/journeys/multisig/multisig-account-options";
import { multisigDeployFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-deploy-view";
import {
  multisigAddFlow,
  multisigReceiveFlow,
  multisigSignersFlow,
  multisigTrackFlow,
  multisigWatchFlow,
} from "../../../../src/sidepanel/journeys/multisig/multisig-management-views";
import {
  multisigDetailFlow,
  multisigProposeFlow,
  multisigsFlow,
} from "../../../../src/sidepanel/journeys/multisig/multisig-views";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";

describe("Argent multisig list and exact-intent detail", () => {
  test("scopes watched accounts and open-intent counts to the active network", async () => {
    const fixture = await makeArgentMultisigFixture();
    const otherNetwork = {
      ...fixture.view,
      record: {
        ...fixture.record,
        id: "SN_SEPOLIA:0x456",
        address: "0x456",
        networkId: "SN_SEPOLIA" as const,
      },
    };
    const html = multisigsFlow(
      fixture.status,
      fixture.status.accounts[0] ?? null,
      [fixture.view, otherNetwork],
      [fixture.intent],
    );
    expect(html).toContain("Treasury");
    expect(html).toContain("1 of 1 signers · 1 open");
    expect(html).not.toContain(otherNetwork.record.id);
  });

  test("renders calls, hash, nonce, fee ceiling, signer choice, and collection state", async () => {
    const fixture = await makeArgentMultisigFixture();
    const html = multisigDetailFlow(
      fixture.status,
      fixture.status.accounts[0] ?? null,
      fixture.view,
      [fixture.intent],
    );
    expect(html).toContain(fixture.intent.prepared.transactionHash);
    expect(html).toContain(`data-copy="${fixture.intent.prepared.transactionHash}"`);
    expect(html).toContain(fixture.intent.prepared.senderAddress);
    expect(html).toContain(fixture.intent.prepared.chainId);
    expect(html).toContain("Maximum network fee");
    expect(html).toContain("0 STRK");
    expect(html).toContain("transfer");
    expect(html).toContain("0xdef");
    expect(html).toContain("What will happen");
    expect(html).toContain("Maximum cost and constraints");
    expect(html).toContain("Technical details");
    expect(html).not.toContain("Collaborator note");
    expect(html).toContain('data-ms-sign="');
    expect(html).toContain("Copy full intent package");
    expect(html).not.toContain('data-ms-submit="');
  });

  test("shows the local summary with exact calls and every verifier warning", async () => {
    const preferences = defaultWalletPreferences();
    const token = preferences.tokens[0];
    if (!token) throw new Error("default token fixture unavailable");
    const fixture = await makeArgentMultisigFixture([
      {
        calldata: ["0x456789abcdef", `0x${(UINT128_LIMIT - 1n).toString(16)}`, "0x0"],
        contractAddress: token.address,
        entrypoint: "approve",
      },
      {
        calldata: [],
        contractAddress: "0x9876543210abcdef",
        entrypoint: "opaque_action",
      },
    ]);
    const html = multisigDetailFlow(
      fixture.status,
      fixture.status.accounts[0] ?? null,
      fixture.view,
      [{ ...fixture.intent, summary: "Looks harmless" }],
      false,
      preferences,
    );

    expect(html).toContain("<h2>Looks harmless</h2>");
    expect(html).toContain("effectively unlimited spending allowance");
    expect(html).toContain("0x9876…cdef is not a token or contact this wallet knows");
    expect(html).toContain("Allow 0x4567…cdef to spend");
    expect(html).toContain("Call opaque_action on 0x9876…cdef");
    expect(html).toContain('class="review-call-assets"');
    expect(html).toContain('class="token-logo"');

    const home = multisigDetailFlow(
      fixture.status,
      fixture.status.accounts[0] ?? null,
      fixture.view,
      [{ ...fixture.intent, summary: "Looks harmless" }],
      false,
      preferences,
      "multisig-home",
    );
    expect(home).toContain('class="multisig-intent-assets"');
    expect(home).toContain('class="token-logo"');
  });

  test("renders exact signer-management authority before collection", async () => {
    const fixture = await makeArgentMultisigFixture([
      {
        calldata: ["0x2", "0x1", "0x0", "0x2"],
        contractAddress: "0x123",
        entrypoint: "add_signers",
      },
    ]);
    const html = multisigDetailFlow(
      fixture.status,
      fixture.status.accounts[0] ?? null,
      fixture.view,
      [fixture.intent],
    );
    expect(html).toContain("Signer authority change");
    expect(html).toContain("Add 1 Argent multisig signer(s) and set threshold to 2");
    expect(html).toContain("Add 0x2");
    expect(html).toContain("Current signers");
    expect(html).toContain(fixture.record.currentConfig?.signerPublicKeys[0] ?? "missing");
    expect(html).toContain("1 of 1 before → 2 of 2 after");
    expect(html).toContain("Resulting threshold · <strong>2 of 2</strong>");
  });

  test("offers submission only for a valid threshold-complete frozen intent", async () => {
    const fixture = await makeArgentMultisigFixture();
    const html = multisigDetailFlow(
      fixture.status,
      fixture.status.accounts[0] ?? null,
      fixture.view,
      [fixture.readyIntent],
    );
    expect(html).toContain('data-ms-submit="');
    expect(html).toContain("Submit transaction");
    expect(html).not.toContain('data-ms-sign="');
    expect(html).toContain("Co-signer handoff");
    expect(html).toContain("Copy full intent package");
    expect(html).toContain("Individual signature fragments");
    expect(html).toContain("1 of 1");
  });

  test("makes package sharing primary when no eligible local signer is available", async () => {
    const fixture = await makeArgentMultisigFixture();
    const signer = fixture.status.accounts[0];
    if (!signer) throw new Error("signer fixture unavailable");
    const observer = {
      ...signer,
      id: "SN_MAIN:0x999",
      publicKeyX: "0x999",
    };
    const html = multisigDetailFlow(
      { ...fixture.status, accountCount: 1, accounts: [observer], activeAccountId: observer.id },
      observer,
      fixture.view,
      [fixture.intent],
    );
    expect(html).toContain("No eligible signer is available in this wallet");
    expect(html).toContain('class="multisig-intent-action"');
    expect(html).toContain('data-ms-copy-package="');
    expect(html).not.toContain('data-ms-sign="');
  });

  test("keeps home intents condensed and moves the full review to the detail flow", async () => {
    const fixture = await makeArgentMultisigFixture();
    const home = multisigDetailFlow(
      fixture.status,
      fixture.status.accounts[0] ?? null,
      fixture.view,
      [fixture.readyIntent],
      false,
      null,
      "multisig-home",
    );
    expect(home).toContain('data-view="multisig-detail"');
    expect(home).toContain("1 of 1 signatures");
    expect(home).toContain(`href="https://starkscan.co/contract/${fixture.record.address}"`);
    expect(home).toContain('aria-label="Open this account on the block explorer"');
    expect(home).toContain('class="ghost small tab-more" data-view="multisig-track"');
    expect(home).toContain("Import intent");
    expect(home).not.toContain('data-ms-submit="');

    const detail = multisigDetailFlow(
      fixture.status,
      fixture.status.accounts[0] ?? null,
      fixture.view,
      [fixture.readyIntent],
    );
    expect(detail).toContain('data-ms-submit="');
    expect(detail).not.toContain('data-ms-home-tab="assets"');
  });

  test("replaces disabled Prepare with a resumable deployment action", async () => {
    const fixture = await makeArgentMultisigFixture();
    const signer = fixture.status.accounts[0];
    if (!signer) throw new Error("signer fixture unavailable");
    const record = {
      ...fixture.record,
      deployment: { salt: "0x5", signerPublicKeys: [signer.publicKeyX], threshold: 1 },
    };
    const undeployed = {
      ...fixture.view,
      authorityStatus: "undeployed",
      config: null,
      deployed: false,
      record,
    } as const;

    const home = multisigDetailFlow(
      fixture.status,
      signer,
      undeployed,
      [],
      false,
      null,
      "multisig-home",
    );
    expect(home).toContain('data-view="multisig-deploy"');
    expect(home).toContain("Deployment required");
    expect(home).not.toContain('data-view="multisig-propose"');

    const deployment = multisigDeployFlow(fixture.status, signer, true, null, undeployed);
    expect(deployment).toContain("Saved setup restored");
    expect(deployment).toContain(`value="${signer.publicKeyX}"`);
    expect(deployment).toContain('name="threshold"');
    expect(deployment).toContain('value="0x5"');
    expect(deployment).toContain(`value="${signer.id}"`);
  });

  test("turns an undeployed address-only watch into a verified deployment setup", async () => {
    const fixture = await makeArgentMultisigFixture();
    const signer = fixture.status.accounts[0];
    if (!signer) throw new Error("signer fixture unavailable");
    const {
      currentConfig: _currentConfig,
      deployment: _deployment,
      ...addressOnlyRecord
    } = fixture.record;
    const undeployed = {
      ...fixture.view,
      authorityStatus: "undeployed",
      config: null,
      deployed: false,
      record: addressOnlyRecord,
    } as const;

    const home = multisigDetailFlow(
      fixture.status,
      signer,
      undeployed,
      [],
      false,
      null,
      "multisig-home",
    );
    expect(home).toContain('data-view="multisig-deploy"');
    expect(home).toContain("enter the original signer set, threshold, and salt");
    expect(home).not.toContain('data-view="multisig-propose"');

    const deployment = multisigDeployFlow(fixture.status, signer, true, null, undeployed);
    expect(deployment).toContain("reproduce the watched address");
    expect(deployment).toContain('name="expectedAddress" type="hidden"');
    expect(deployment).toContain(`value="${fixture.record.address}"`);
    expect(deployment).not.toContain("multisig-contract-details");
  });

  test("disables signing when fresh on-chain authority is unavailable", async () => {
    const fixture = await makeArgentMultisigFixture();
    const account = fixture.status.accounts[0] ?? null;
    const unavailableView = {
      ...fixture.view,
      authorityStatus: "network-unavailable",
      config: null,
      deployed: null,
    } as const;
    const html = multisigDetailFlow(
      fixture.status,
      account,
      unavailableView,
      [fixture.intent],
      true,
    );
    expect(html).toContain("latest signer-authority refresh failed");
    expect(html).not.toContain('data-ms-sign="');

    const home = multisigDetailFlow(
      fixture.status,
      account,
      unavailableView,
      [fixture.intent],
      true,
      null,
      "multisig-home",
    );
    expect(home).not.toContain("Current on-chain signer authority is unavailable");
    expect(home).toContain("Signer authority could not be refreshed");
    expect(home).toContain('data-view="multisig-propose" type="button" disabled');
  });

  test("places the external intent handoff inside the empty Intents tab", async () => {
    const fixture = await makeArgentMultisigFixture();
    const home = multisigDetailFlow(
      fixture.status,
      fixture.status.accounts[0] ?? null,
      fixture.view,
      [],
      false,
      null,
      "multisig-home",
    );
    expect(home).toContain("Import a package from another signer to review it here");
    expect(home).toContain('class="ghost small tab-more" data-view="multisig-track"');
    expect(home.match(/data-view="multisig-track"/g)).toHaveLength(1);
  });

  test("suppresses every signing action when fresh authority differs from the frozen snapshot", async () => {
    const fixture = await makeArgentMultisigFixture();
    const html = multisigDetailFlow(
      fixture.status,
      fixture.status.accounts[0] ?? null,
      {
        ...fixture.view,
        config: {
          classHash: fixture.record.classHash,
          signerGuids: [...(fixture.view.config?.signerGuids ?? []), "0x999"],
          threshold: fixture.view.config?.threshold ?? 1,
        },
      },
      [fixture.readyIntent],
    );

    expect(html).toContain("does not exactly match this intent snapshot");
    expect(html).not.toContain('data-ms-sign="');
    expect(html).not.toContain('data-ms-submit="');
    expect(html).not.toContain("Import signature fragment");
  });
});

describe("Argent frozen-intent composer", () => {
  test("registers existing accounts by address and derives authority from chain", async () => {
    const fixture = await makeArgentMultisigFixture();
    const html = multisigWatchFlow(fixture.status, fixture.status.accounts[0] ?? null);
    expect(html).toContain('name="address"');
    expect(html).toContain("If deployed, signer authority syncs from Starknet");
    expect(html).not.toContain('name="signerPublicKeys"');
    expect(html).not.toContain('name="signerAccountId"');
    expect(html).not.toContain('name="threshold"');
    expect(html).not.toContain('name="salt"');
  });

  test("shows a matched local signer without enabling an incomplete watched setup", async () => {
    const fixture = await makeArgentMultisigFixture();
    const record = { ...fixture.record };
    delete record.currentConfig;
    const html = multisigDetailFlow(
      fixture.status,
      fixture.status.accounts[0] ?? null,
      { ...fixture.view, record },
      [],
      false,
      null,
      "multisig-home",
    );
    expect(html).toContain("Signer found");
    expect(html).toContain('data-view="multisig-propose" type="button" disabled');
  });

  test("starts with a familiar token transfer and keeps raw calls advanced", async () => {
    const fixture = await makeArgentMultisigFixture();
    const preferences = defaultWalletPreferences();
    const token = preferences.tokens.find((candidate) => candidate.symbol === "STRK");
    if (!token) throw new Error("STRK fixture unavailable");
    const html = multisigProposeFlow(fixture.status, fixture.view, preferences, {
      balances: { balances: [{ ...token, balance: "42000000000000000000", formatted: "42" }] },
      changes: {},
      currency: "usd",
      nfts: [],
      prices: { [token.address]: 0.5 },
    });
    expect(html).toContain("New transaction");
    expect(html).toContain("Nothing is signed or submitted");
    expect(html).toContain("<strong>Treasury</strong>");
    expect(html).toContain(`data-multisig-id="${fixture.record.id}"`);
    expect(html).toContain("Review transaction");
    expect(html).toContain("Choose saved recipient");
    expect(html).toContain("STRK");
    expect(html).toContain("token-logo");
    expect(html).toContain("Advanced contract call");
    expect(html).toContain('data-ms-prepare="contract"');
  });

  test("does not render a form without freshly verified authority", async () => {
    const fixture = await makeArgentMultisigFixture();
    const html = multisigProposeFlow(fixture.status, {
      ...fixture.view,
      authorityStatus: "network-unavailable",
      config: null,
      deployed: null,
    });
    expect(html).toContain("Signer authority could not be refreshed");
    expect(html).not.toContain('id="multisig-propose-form"');
  });
});

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
    expect(ready).toContain('data-add-signer-public-key="0x999"');
    expect(ready).toContain("Signer set");
    expect(ready).toContain("Add signer");
    expect(ready).toContain('name="signerPublicKeys" type="hidden"');
    expect(ready).not.toContain("Space-separated public keys");
    expect(ready).toContain('name="signerAccountId" type="hidden"');
    expect(ready).toContain("Continue to approval");
    expect(ready).toContain("data-multisig-deploy-back");
    expect(ready).toContain("Review deployment");
  });

  test("renders setup, live authority, receive, import, and account-picker states", async () => {
    const fixture = await makeArgentMultisigFixture();
    const account = fixture.status.accounts[0] ?? null;

    const setup = multisigAddFlow(fixture.status, account);
    expect(setup).toContain("Create a new multisig");
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
