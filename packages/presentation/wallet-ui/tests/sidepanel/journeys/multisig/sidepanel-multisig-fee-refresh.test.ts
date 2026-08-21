/** Focused recovery UI for expired Argent multisig fee bounds. */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@mc-wallet/settings/preferences";
import { argentMultisigTransactionHash } from "@mc-wallet/starknet/multisig-invoke";
import { multisigDetailFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-views";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flushMultisigUi,
  makeMultisigUiClient,
  mountMultisigUi,
} from "../../../support/multisig-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

describe("Argent multisig fee refresh", () => {
  test("distinguishes a fee replacement from the retained failed attempt", async () => {
    const fixture = await makeArgentMultisigFixture();
    const stale = { ...fixture.readyIntent, state: "stale" as const };
    const fields = {
      ...fixture.intent.prepared,
      resourceBounds: {
        ...fixture.intent.prepared.resourceBounds,
        l1Gas: { maxAmount: "0x2", maxPricePerUnit: "0x8" },
      },
    };
    const prepared = { ...fields, transactionHash: argentMultisigTransactionHash(fields) };
    const replacement = {
      ...fixture.intent,
      id: `${fixture.intent.accountId}:${prepared.transactionHash}`,
      prepared,
      signatures: fixture.readyIntent.signatures.slice(0, 1),
    };
    const html = multisigDetailFlow(
      fixture.status,
      fixture.status.accounts[0] ?? null,
      fixture.view,
      [stale, replacement],
      false,
      defaultWalletPreferences(),
      "multisig-detail",
      undefined,
      replacement.id,
    );

    expect(html).toContain("Updated transaction");
    expect(html).toContain("new transaction hash");
    expect(html).toContain("1 of 1 new signature");
    expect(html).toContain("Delete saved intent");
  });

  test("re-prepares the exact stale calls and opens only the replacement intent", async () => {
    const fixture = await makeArgentMultisigFixture();
    const stale = { ...fixture.readyIntent, state: "stale" as const };
    const replacement = { ...fixture.intent, id: `${fixture.intent.id}:replacement` };
    const prepared: unknown[] = [];
    const opened: unknown[] = [];
    const client = await makeMultisigUiClient({
      loadMultisigs: async () => ({ intents: [stale], multisigs: [fixture.view] }),
      async prepareIntent(multisigId, calls) {
        prepared.push({ calls, multisigId });
        return { intent: replacement };
      },
    });
    const app = mountMultisigUi(
      multisigDetailFlow(
        fixture.status,
        fixture.status.accounts[0] ?? null,
        fixture.view,
        [stale],
        false,
        defaultWalletPreferences(),
        "multisig-detail",
        undefined,
        stale.id,
      ),
      client,
      fixture.status,
      { openIntent: (...args) => opened.push(args) },
    );

    expect(app.textContent).toContain("This transaction was not submitted");
    expect(app.textContent).toContain("Review updated transaction");
    app.querySelector<HTMLButtonElement>("[data-ms-refresh-intent]")?.click();
    await flushMultisigUi();
    expect(prepared).toEqual([{ calls: stale.prepared.calls, multisigId: stale.accountId }]);
    expect(opened).toEqual([[stale.accountId, replacement.id]]);
  });

  test("opens an updated transaction automatically after a fee-floor rejection", async () => {
    const fixture = await makeArgentMultisigFixture();
    const stale = { ...fixture.readyIntent, state: "stale" as const };
    const replacement = { ...fixture.intent, id: `${fixture.intent.id}:replacement` };
    const prepared: unknown[] = [];
    const opened: unknown[] = [];
    const client = await makeMultisigUiClient({
      loadMultisigs: async () => ({ intents: [stale], multisigs: [fixture.view] }),
      async prepareIntent(multisigId, calls) {
        prepared.push({ calls, multisigId });
        return { intent: replacement };
      },
      async submitIntent() {
        throw new Error(
          "Max L1DataGas price (235129044270) is lower than the actual gas price: 863576035385",
        );
      },
    });
    const app = mountMultisigUi(
      multisigDetailFlow(fixture.status, fixture.status.accounts[0] ?? null, fixture.view, [
        fixture.readyIntent,
      ]),
      client,
      fixture.status,
      { openIntent: (...args) => opened.push(args) },
    );

    app.querySelector<HTMLButtonElement>("[data-ms-submit]")?.click();
    await flushMultisigUi();
    expect(prepared).toEqual([{ calls: stale.prepared.calls, multisigId: stale.accountId }]);
    expect(opened).toEqual([[stale.accountId, replacement.id]]);
    expect(document.querySelector(".toast.error .toast-text")?.textContent).toBe(
      "Not submitted — network fees changed.",
    );
  });

  test("requires two taps to delete the inspected local intent", async () => {
    const fixture = await makeArgentMultisigFixture();
    const removed: string[] = [];
    const opened: unknown[] = [];
    const client = await makeMultisigUiClient({
      async removeIntent(id) {
        removed.push(id);
      },
    });
    const app = mountMultisigUi(
      multisigDetailFlow(
        fixture.status,
        fixture.status.accounts[0] ?? null,
        fixture.view,
        [fixture.intent],
        false,
        defaultWalletPreferences(),
        "multisig-detail",
        undefined,
        fixture.intent.id,
      ),
      client,
      fixture.status,
      { openDetail: (...args) => opened.push(args) },
    );
    const control = app.querySelector<HTMLButtonElement>("[data-ms-delete-intent]");
    expect(control?.closest(".decision-technical")).not.toBeNull();

    control?.click();
    expect(removed).toEqual([]);
    expect(control?.textContent).toBe("Confirm delete intent");
    control?.click();
    await flushMultisigUi();
    expect(removed).toEqual([fixture.intent.id]);
    expect(opened).toEqual([[fixture.intent.accountId, "multisig-home"]]);
  });
});
