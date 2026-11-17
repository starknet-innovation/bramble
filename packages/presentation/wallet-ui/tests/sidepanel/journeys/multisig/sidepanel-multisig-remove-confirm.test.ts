/**
 * "Stop watching" asks for a second press when the background refuses a
 * removal pending confirmation: an undeployed multisig whose setup only this
 * wallet holds (Sherlock 214), or saved transactions and history.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { UNDEPLOYED_REMOVAL_PROMPT } from "../../../../src/sidepanel/runtime/friendly-error-copy-multisig";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flushMultisigUi as flush,
  mountMultisigUi as mount,
  makeMultisigUiClient as testClient,
} from "../../../support/multisig-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const LIST = `
  <button type="button" data-multisig-remove="SN_MAIN:0x7aaa"><span>Stop watching</span></button>
  <p id="multisig-detail-result"></p>`;

// Mounts the list with a removal that the background refuses once with
// `refusal` unless confirmed, and records each request's confirmation flag.
const mountRemoval = async (refusal: string) => {
  const fixture = await makeArgentMultisigFixture();
  const requests: boolean[] = [];
  const app = mount(
    LIST,
    await testClient({
      async removeMultisig(_id, confirmHistoryRemoval = false) {
        requests.push(confirmHistoryRemoval);
        if (!confirmHistoryRemoval) throw new Error(refusal);
      },
    }),
    fixture.status,
  );
  const button = app.querySelector<HTMLButtonElement>("[data-multisig-remove]");
  if (!button) throw new Error("missing remove button");
  const press = async () => {
    button.click();
    await flush();
  };
  return { app, button, press, requests };
};

describe("Stop watching", () => {
  test("asks again before removing an undeployed multisig, then confirms", async () => {
    const { app, button, press, requests } = await mountRemoval(
      "confirm removal of an undeployed Argent multisig",
    );

    await press();
    expect(button.textContent).toBe("Remove anyway");
    expect(app.querySelector("#multisig-detail-result")?.textContent).toBe(
      UNDEPLOYED_REMOVAL_PROMPT,
    );

    await press();
    expect(requests).toEqual([false, true]);
  });

  test("keeps the history prompt for a multisig with saved history", async () => {
    const { button, press, requests } = await mountRemoval(
      "confirm removal of terminal Argent multisig history",
    );

    await press();
    expect(button.textContent).toBe("Confirm removal and delete terminal history");
    await press();
    expect(requests).toEqual([false, true]);
  });

  test("does not offer a second press for any other refusal", async () => {
    const { button, press, requests } = await mountRemoval("wallet locked");

    await press();
    await press();
    expect(button.textContent).toBe("Stop watching");
    expect(requests).toEqual([false, false]);
  });
});
