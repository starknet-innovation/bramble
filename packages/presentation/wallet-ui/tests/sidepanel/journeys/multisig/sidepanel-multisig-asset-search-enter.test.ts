/**
 * Audit 248, multisig twin: Enter in the transfer composer's token search must
 * not implicitly submit the form, which would prepare an intent for the
 * previously selected hidden token instead of the one being searched for.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flushMultisigUi as flush,
  mountMultisigUi as mount,
  makeMultisigUiClient as testClient,
} from "../../../support/multisig-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

// Emulates the browser's implicit submission: Enter in a text field submits
// the enclosing form unless a keydown listener cancelled it.
const pressEnter = (field: HTMLInputElement, form: HTMLFormElement): boolean => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" });
  field.dispatchEvent(event);
  if (!event.defaultPrevented) form.requestSubmit();
  return event.defaultPrevented;
};

describe("multisig transfer token search", () => {
  test("Enter while searching does not prepare the previously selected token", async () => {
    const fixture = await makeArgentMultisigFixture();
    const prepared: unknown[] = [];
    const client = await testClient({
      async prepareIntent(multisigId, calls) {
        prepared.push({ calls, multisigId });
        return { intent: fixture.intent };
      },
    });
    const app = mount(
      `<form data-ms-prepare="transfer" data-multisig-id="${fixture.record.id}">
        <input name="recipient" value="0xabc" />
        <input type="search" id="multisig-asset-search" value="usdc" />
        <input name="amount" value="1.25" />
        <input name="tokenAddress" value="0x000DEF" />
        <input name="tokenBalance" value="500" />
        <input name="tokenDecimals" value="2" />
        <input name="tokenPrice" value="2" />
        <button type="submit">Review</button>
      </form>`,
      client,
      fixture.status,
    );
    const form = app.querySelector<HTMLFormElement>("[data-ms-prepare]");
    const search = app.querySelector<HTMLInputElement>("#multisig-asset-search");
    if (!form || !search) throw new Error("composer did not render");

    expect(pressEnter(search, form)).toBe(true);
    await flush();
    expect(prepared).toEqual([]);

    // An explicit Review still prepares the selected token.
    form.requestSubmit();
    await flush();
    expect(prepared).toHaveLength(1);
  });
});
