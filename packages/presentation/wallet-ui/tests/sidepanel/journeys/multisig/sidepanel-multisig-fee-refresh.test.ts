/** Focused recovery UI for expired Argent multisig fee bounds. */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@mc-wallet/settings/preferences";
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

    expect(app.textContent).toContain("existing signatures cannot carry over");
    app.querySelector<HTMLButtonElement>("[data-ms-refresh-intent]")?.click();
    await flushMultisigUi();
    expect(prepared).toEqual([{ calls: stale.prepared.calls, multisigId: stale.accountId }]);
    expect(opened).toEqual([[stale.accountId, replacement.id]]);
  });
});
