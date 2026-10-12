/**
 * Preparing calls a stale version may already have sent (Sherlock 177).
 *
 * The background refuses the same calls at a later nonce until the user
 * confirms, because co-signers may have sent their own version of the stale
 * transaction. The refusal turns the control into "Send anyway", and only its
 * next press carries the confirmation.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { createMultisigClient } from "../../../../src/sidepanel/journeys/multisig/multisig-runtime";
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

const REFUSAL = "confirm resending calls an earlier Argent multisig intent may have sent";
const PROMPT = "This may already have been sent by another signer. Press again to send it anyway.";

const toastText = (): string =>
  Array.from(document.querySelectorAll(".toast-text"))
    .map((node) => node.textContent ?? "")
    .join(" | ");

describe("updating the fee of a stale transaction", () => {
  test("asks once, then sends the confirmation with the next press", async () => {
    const fixture = await makeArgentMultisigFixture();
    const stale = { ...fixture.readyIntent, state: "stale" as const };
    const replacement = { ...fixture.intent, id: `${fixture.intent.id}:replacement` };
    const confirmations: boolean[] = [];
    const opened: unknown[] = [];
    const client = await makeMultisigUiClient({
      loadMultisigs: async () => ({ intents: [stale], multisigs: [fixture.view] }),
      async prepareIntent(_multisigId, _calls, confirmResend = false) {
        confirmations.push(confirmResend);
        if (!confirmResend) throw new Error(REFUSAL);
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
    const button = app.querySelector<HTMLButtonElement>("[data-ms-refresh-intent]");

    button?.click();
    await flushMultisigUi();
    expect(confirmations).toEqual([false]);
    expect(opened).toEqual([]);
    expect(button?.textContent).toContain("Send anyway");
    expect(toastText()).toContain(PROMPT);

    button?.click();
    await flushMultisigUi();
    expect(confirmations).toEqual([false, true]);
    expect(opened).toEqual([[stale.accountId, replacement.id]]);
  });
});

describe("preparing a new multisig transaction", () => {
  const form = (multisigId: string) =>
    `<form data-ms-prepare="contract" data-multisig-id="${multisigId}">
      <input name="contractAddress" value="0xdef" />
      <input name="entrypoint" value="transfer" />
      <textarea name="calldata">0x1</textarea>
      <button type="submit">Prepare</button>
    </form>`;

  test("turns the button into Send anyway and confirms on the next submit", async () => {
    const fixture = await makeArgentMultisigFixture();
    const confirmations: boolean[] = [];
    const opened: unknown[] = [];
    const client = await makeMultisigUiClient({
      async prepareIntent(_multisigId, _calls, confirmResend = false) {
        confirmations.push(confirmResend);
        if (!confirmResend) throw new Error(REFUSAL);
        return { intent: fixture.intent };
      },
    });
    const app = mountMultisigUi(form(fixture.record.id), client, fixture.status, {
      openIntent: (...args) => opened.push(args),
    });
    const prepare = app.querySelector<HTMLFormElement>("[data-ms-prepare]");
    const button = prepare?.querySelector<HTMLButtonElement>('button[type="submit"]');

    prepare?.requestSubmit();
    await flushMultisigUi();
    expect(button?.textContent).toContain("Send anyway");
    expect(button?.disabled).toBe(false);
    expect(toastText()).toContain(PROMPT);

    prepare?.requestSubmit();
    await flushMultisigUi();
    expect(confirmations).toEqual([false, true]);
    expect(opened).toEqual([[fixture.record.id, fixture.intent.id]]);
  });

  test("another refusal never arms the confirmation", async () => {
    const fixture = await makeArgentMultisigFixture();
    const confirmations: boolean[] = [];
    const client = await makeMultisigUiClient({
      async prepareIntent(_multisigId, _calls, confirmResend = false) {
        confirmations.push(confirmResend);
        throw new Error("Argent multisig intent was already sent");
      },
    });
    const app = mountMultisigUi(form(fixture.record.id), client, fixture.status);
    const prepare = app.querySelector<HTMLFormElement>("[data-ms-prepare]");

    prepare?.requestSubmit();
    await flushMultisigUi();
    prepare?.requestSubmit();
    await flushMultisigUi();
    expect(confirmations).toEqual([false, false]);
    expect(prepare?.textContent).not.toContain("Send anyway");
  });
});

describe("the multisig client", () => {
  test("sends confirmResend only when the user confirmed", async () => {
    const fixture = await makeArgentMultisigFixture();
    const messages: unknown[] = [];
    const client = createMultisigClient({
      async sendMessage(message) {
        messages.push(message);
        return { intent: fixture.intent, ok: true };
      },
    });
    const calls = [{ calldata: ["0x1"], contractAddress: "0xdef", entrypoint: "transfer" }];

    await client.prepareIntent(fixture.record.id, calls).catch(() => undefined);
    await client.prepareIntent(fixture.record.id, calls, true).catch(() => undefined);

    expect(messages).toEqual([
      { calls, multisigId: fixture.record.id, type: "wallet.prepareArgentMultisigIntent" },
      {
        calls,
        confirmResend: true,
        multisigId: fixture.record.id,
        type: "wallet.prepareArgentMultisigIntent",
      },
    ]);
  });
});
