/**
 * Multisig DOM bindings at the response/UI boundary: acknowledgement toggles
 * cannot re-enable a statically forbidden signer action, and explicit retry
 * controls rehydrate instead of leaving a false empty state.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bindMultisigs, type MultisigUiDeps } from "../../src/sidepanel/multisig-ui";
import { registerDom, unregisterDom } from "../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const mount = (html: string, render: () => Promise<void> = async () => {}) => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.append(document.createRange().createContextualFragment(html));
  document.body.append(app);
  bindMultisigs({
    app,
    multisig: {},
    openDetail() {},
    openList() {},
    render,
    selectedMultisigId: () => null,
    wallet: {
      async loadStatus() {
        return {};
      },
    },
  } as unknown as MultisigUiDeps);
  return app;
};

describe("bindMultisigs", () => {
  test("acknowledgement enables only actions allowed by signer state", () => {
    const app = mount(`
      <div class="allowance-row">
        <input type="checkbox" data-ms-ack />
        <button data-ms-requires-ack="true" data-ms-action-allowed="true" disabled></button>
        <button data-ms-requires-ack="true" data-ms-action-allowed="false" disabled></button>
      </div>`);
    const checkbox = app.querySelector<HTMLInputElement>("[data-ms-ack]");
    const buttons = app.querySelectorAll<HTMLButtonElement>("[data-ms-requires-ack]");
    if (checkbox) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change"));
    }
    expect(buttons[0]?.disabled).toBe(false);
    expect(buttons[1]?.disabled).toBe(true);
  });

  test("the list error retry requests a fresh render", async () => {
    let renders = 0;
    const app = mount('<button id="multisig-list-retry" type="button"></button>', async () => {
      renders += 1;
    });
    app.querySelector<HTMLButtonElement>("#multisig-list-retry")?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(renders).toBe(1);
  });
});
