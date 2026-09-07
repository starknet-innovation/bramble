/** Focused recovery UI for expired Argent multisig fee bounds. */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { argentMultisigTransactionHash } from "@bramble/starknet/multisig-invoke";
import {
  bindMultisigs,
  type MultisigUiDeps,
} from "../../../../src/sidepanel/journeys/multisig/multisig-ui";
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

    expect(html).toContain("Fee-updated transaction");
    expect(html).toContain("different transaction hash");
    expect(html).toContain("cannot authorize this version");
    expect(html).toContain("1 of 1 fresh approval");
    expect(html).toContain("Delete saved intent");
  });

  test("keeps one logical row and makes the fully signed attempt retryable", async () => {
    const fixture = await makeArgentMultisigFixture();
    const stale = { ...fixture.readyIntent, state: "stale" as const };
    const replacement = {
      ...fixture.intent,
      id: `${fixture.intent.id}:replacement`,
      signatures: fixture.readyIntent.signatures.slice(0, 1),
    };
    const duplicate = { ...replacement, id: `${replacement.id}:duplicate`, signatures: [] };
    const home = multisigDetailFlow(
      fixture.status,
      fixture.status.accounts[0] ?? null,
      fixture.view,
      [stale, replacement, duplicate],
      false,
      defaultWalletPreferences(),
      "multisig-home",
    );
    const detail = multisigDetailFlow(
      fixture.status,
      fixture.status.accounts[0] ?? null,
      fixture.view,
      [stale, replacement, duplicate],
      false,
      defaultWalletPreferences(),
      "multisig-detail",
      undefined,
      stale.id,
    );

    expect(home.match(/data-ms-open-intent=/g)).toHaveLength(1);
    expect(home).toContain("Not submitted · ready to retry");
    expect(detail).toContain("Nothing was sent");
    expect(detail).toContain("Continue the fee-updated transaction and collect 1 fresh approval");
    expect(detail).toContain(
      "retry this version with its existing 1 approval if network fees fall",
    );
    expect(detail).toContain("Try unchanged fee again");
    expect(detail).toContain("Continue fee-updated transaction");
    expect(detail.indexOf("data-ms-refresh-intent")).toBeLessThan(detail.indexOf("data-ms-submit"));
    expect(detail).not.toContain(">stale<");

    const settled = multisigDetailFlow(
      fixture.status,
      fixture.status.accounts[0] ?? null,
      fixture.view,
      [{ ...stale, state: "submitted" }, replacement],
      false,
      defaultWalletPreferences(),
      "multisig-home",
    );
    expect(settled).not.toContain("data-ms-open-intent");
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

    expect(app.textContent).toContain("Nothing was sent");
    expect(app.textContent).toContain("Update network fee");
    app.querySelector<HTMLButtonElement>("[data-ms-refresh-intent]")?.click();
    await flushMultisigUi();
    expect(prepared).toEqual([{ calls: stale.prepared.calls, multisigId: stale.accountId }]);
    expect(opened).toEqual([[stale.accountId, replacement.id]]);
  });

  test("reuses the strongest existing fee replacement without preparing another", async () => {
    const fixture = await makeArgentMultisigFixture();
    const stale = { ...fixture.readyIntent, state: "stale" as const };
    const empty = { ...fixture.intent, id: `${fixture.intent.id}:empty` };
    const replacement = {
      ...fixture.intent,
      id: `${fixture.intent.id}:signed`,
      signatures: fixture.readyIntent.signatures.slice(0, 1),
    };
    const prepared: unknown[] = [];
    const opened: unknown[] = [];
    const client = await makeMultisigUiClient({
      loadMultisigs: async () => ({
        intents: [stale, empty, replacement],
        multisigs: [fixture.view],
      }),
      async prepareIntent(multisigId, calls) {
        prepared.push({ calls, multisigId });
        return { intent: empty };
      },
    });
    const app = mountMultisigUi(
      multisigDetailFlow(
        fixture.status,
        fixture.status.accounts[0] ?? null,
        fixture.view,
        [stale, empty, replacement],
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

    app.querySelector<HTMLButtonElement>("[data-ms-refresh-intent]")?.click();
    await flushMultisigUi();
    expect(prepared).toEqual([]);
    expect(opened).toEqual([[stale.accountId, replacement.id]]);
  });

  test("does not create a replacement automatically after a fee-floor rejection", async () => {
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
    expect(prepared).toEqual([]);
    expect(opened).toEqual([]);
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

  test("keeps the user in the intents tab after checking for co-signer updates", async () => {
    const fixture = await makeArgentMultisigFixture();
    const synced: string[] = [];
    const opened: string[][] = [];
    let intentIds: readonly string[] = [];
    const client = await makeMultisigUiClient({
      syncIntents: async (multisigId) => {
        synced.push(multisigId);
        return { imported: intentIds.length, intentIds, received: intentIds.length };
      },
    });
    const app = document.createElement("div");
    document.body.replaceChildren(app);
    const markup = (): string =>
      multisigDetailFlow(
        fixture.status,
        fixture.status.accounts[0] ?? null,
        fixture.view,
        [fixture.intent],
        false,
        defaultWalletPreferences(),
        "multisig-home",
      );
    const deps = {
      app,
      multisig: client,
      openDetail() {},
      openIntent: (...args: string[]) => opened.push(args),
      openList() {},
      async render() {
        app.replaceChildren(document.createRange().createContextualFragment(markup()));
        bindMultisigs(deps);
      },
      selectedMultisigId: () => fixture.record.id,
      wallet: {
        loadStatus: async () => fixture.status,
      } as unknown as MultisigUiDeps["wallet"],
    } as const;
    await deps.render();
    app.querySelector<HTMLButtonElement>('[data-ms-home-tab="intents"]')?.click();
    app.querySelector<HTMLButtonElement>("[data-ms-sync-intents]")?.click();
    await flushMultisigUi();

    expect(synced).toEqual([fixture.record.id]);
    expect(app.querySelector('[data-ms-home-tab="intents"]')?.getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(app.querySelector<HTMLElement>('[data-ms-home-panel="intents"]')?.hidden).toBe(false);
    expect(document.activeElement).toBe(app.querySelector("[data-ms-sync-intents]"));

    intentIds = [fixture.intent.id];
    app.querySelector<HTMLButtonElement>("[data-ms-sync-intents]")?.click();
    await flushMultisigUi();
    expect(opened).toEqual([[fixture.record.id, fixture.intent.id]]);
    expect(document.body.textContent).toContain("1 signing intent updated");

    intentIds = [fixture.intent.id, `${fixture.intent.id}:other`];
    app.querySelector<HTMLButtonElement>("[data-ms-sync-intents]")?.click();
    await flushMultisigUi();
    expect(opened).toEqual([[fixture.record.id, fixture.intent.id]]);
    expect(document.body.textContent).toContain(
      "2 signing intents updated. Review them in Intents",
    );
  });

  test("names partial secure delivery and leaves sharing ready to retry", async () => {
    const fixture = await makeArgentMultisigFixture();
    const client = await makeMultisigUiClient({
      shareIntent: async () => ({ recipients: 1, totalRecipients: 2 }),
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
    );

    const share = app.querySelector<HTMLButtonElement>("[data-ms-share]");
    share?.click();
    await flushMultisigUi();
    expect(document.querySelector(".toast.error")?.textContent).toContain(
      "Reached 1 of 2 co-signers. Share again to retry the remaining delivery.",
    );
    expect(share?.disabled).toBe(false);
  });
});
