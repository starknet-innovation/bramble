/** Argent multisig views expose exact frozen authority and fail closed without freshness. */
import { describe, expect, test } from "bun:test";
import { multisigWatchFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-management-views";
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
    expect(html).toContain('data-ms-sign="');
    expect(html).toContain("Copy intent package");
    expect(html).not.toContain('data-ms-submit="');
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
