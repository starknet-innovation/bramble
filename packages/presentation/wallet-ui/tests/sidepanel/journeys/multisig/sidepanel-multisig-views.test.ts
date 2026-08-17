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
    expect(html).toContain("Copy intent package");
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
    expect(html).toContain("1 of 1");
  });

  test("disables signing when fresh on-chain authority is unavailable", async () => {
    const fixture = await makeArgentMultisigFixture();
    const html = multisigDetailFlow(
      fixture.status,
      fixture.status.accounts[0] ?? null,
      { config: null, record: fixture.record },
      [fixture.intent],
      true,
    );
    expect(html).toContain("Current on-chain signer authority is unavailable");
    expect(html).not.toContain('data-ms-sign="');
    expect(html).toMatch(/data-view="multisig-propose"[^>]*disabled/);
  });

  test("suppresses every signing action when fresh authority differs from the frozen snapshot", async () => {
    const fixture = await makeArgentMultisigFixture();
    const html = multisigDetailFlow(
      fixture.status,
      fixture.status.accounts[0] ?? null,
      {
        config: {
          classHash: fixture.record.classHash,
          signerGuids: [...(fixture.view.config?.signerGuids ?? []), "0x999"],
          threshold: fixture.view.config?.threshold ?? 1,
        },
        record: fixture.record,
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
  test("registers existing accounts by address and current authority, not constructor salt", async () => {
    const fixture = await makeArgentMultisigFixture();
    const html = multisigWatchFlow(fixture.status, fixture.status.accounts[0] ?? null);
    expect(html).toContain('name="address"');
    expect(html).toContain("Current signer public keys");
    expect(html).not.toContain('name="salt"');
  });

  test("states the exact signed fields and binds the selected account id", async () => {
    const fixture = await makeArgentMultisigFixture();
    const html = multisigProposeFlow(fixture.status, fixture.view);
    expect(html).toContain("freezes one exact Starknet V3 transaction");
    expect(html).toContain("nonce, sender, fee ceiling, chain and transaction hash");
    expect(html).toContain(`data-multisig-id="${fixture.record.id}"`);
    expect(html).toContain("Prepare exact transaction");
  });

  test("does not render a form without freshly verified authority", async () => {
    const fixture = await makeArgentMultisigFixture();
    const html = multisigProposeFlow(fixture.status, {
      config: null,
      record: fixture.record,
    });
    expect(html).toContain("Current on-chain signer authority is unavailable");
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
    const ready = multisigDeployFlow(fixture.status, account, true, defaultWalletPreferences());
    expect(ready).toContain('id="multisig-deploy-form"');
    expect(ready).toContain(`value="${account?.publicKeyX}"`);
    expect(ready).toContain("Review deployment");
  });

  test("renders setup, live authority, receive, import, and account-picker states", async () => {
    const fixture = await makeArgentMultisigFixture();
    const account = fixture.status.accounts[0] ?? null;

    expect(multisigAddFlow(fixture.status, account)).toContain("Create a new multisig");
    expect(multisigAddFlow(fixture.status, null)).toContain("No account on");
    expect(multisigSignersFlow(fixture.status, account, null)).toContain("no longer watched");
    expect(multisigSignersFlow(fixture.status, account, fixture.view)).toContain(
      fixture.view.config?.signerGuids[0] ?? "missing",
    );
    expect(
      multisigSignersFlow(fixture.status, account, { ...fixture.view, config: null }),
    ).toContain("Signing is disabled");
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
