/** Terminal multisig intents use the wallet's standard transaction receipt. */
import { expect, test } from "bun:test";
import { multisigDetailFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-views";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";

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
  );

  expect(html).toContain('class="send-outcome send-success multisig-intent-success"');
  expect(html).toContain('class="send-success-check"');
  expect(html).toContain("Transaction submitted");
  expect(html).toContain('data-view="multisig-home"');
  expect(html).not.toContain('data-ms-submit="');
  expect(html).not.toContain("Co-signer handoff");
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
