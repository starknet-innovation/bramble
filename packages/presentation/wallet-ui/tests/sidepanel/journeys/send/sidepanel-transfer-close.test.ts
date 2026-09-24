/**
 * What closing Send keeps and what it discards: a composition is abandoned so
 * the next visit starts clean, while a submitted transaction stays reachable
 * because the user may come back for its receipt.
 *
 * Split from `sidepanel-transfer-ui.test.ts` to keep both files within the
 * file-length standard; the harness and the bindings under test are the same.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import { sendFlow } from "../../../../src/sidepanel/app/screens/flows";
import { bindTransfer } from "../../../../src/sidepanel/journeys/send/transfer-ui";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flush,
  mountTransferUi as mount,
  paint,
  transferPreferences as preferences,
  TRANSFER_RECIPIENT as RECIPIENT,
  setTransferField as setField,
  walletStatus as status,
  submitTransferForm as submit,
} from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const originalSetTimeout = globalThis.setTimeout;

beforeEach(() => {
  document.body.replaceChildren();
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void) => {
    fn();
    return 0;
  }) as unknown as typeof setTimeout;
});

afterEach(() => {
  (globalThis as { setTimeout: unknown }).setTimeout = originalSetTimeout;
});

describe("closing Send", () => {
  test("abandons what was composed, so the next visit starts over", () => {
    // Reported from the shield shortcut: open Send pre-configured, close it with
    // the cross, then press Send from home — it reopened on the amount step with
    // the shield still filled in, because the journey outlived the close.
    const { app, deps } = mount();
    bindTransfer(deps);
    // Pick a recipient the way the screen does, which advances to the amount.
    const search = app.querySelector<HTMLInputElement>("#send-recipient-search");
    if (search) {
      search.value = RECIPIENT;
      search.dispatchEvent(new Event("input", { bubbles: true }));
    }
    app.querySelector<HTMLButtonElement>("#send-recipient-continue")?.click();
    setField(app, "amount", "1");
    expect(app.querySelector("#send-details")?.hasAttribute("hidden")).toBe(false);
    // Stored canonically, so compare loosely: the point is that it is set.
    expect(app.querySelector<HTMLInputElement>('[name="recipient"]')?.value).not.toBe("");

    app.querySelector<HTMLButtonElement>("#send-close")?.click();
    // Re-entering rebinds against freshly rendered markup, as a repaint does.
    paint(app, sendFlow(status, account, preferences));
    bindTransfer(deps);

    expect(app.querySelector("#send-recipient-stage")?.hasAttribute("hidden")).toBe(false);
    expect(app.querySelector("#send-details")?.hasAttribute("hidden")).toBe(true);
    expect(app.querySelector<HTMLInputElement>('[name="recipient"]')?.value).toBe("");
  });

  test("keeps a submitted transaction reachable after closing", async () => {
    // The opposite case: once something is on chain, closing must not discard the
    // receipt the user may come back for.
    const { app, deps } = mount();
    bindTransfer(deps);
    setField(app, "recipient", RECIPIENT);
    setField(app, "amount", "1");
    submit(app);
    await flush();
    submit(app);
    await flush();
    expect(app.querySelector("#send-success")?.hasAttribute("hidden")).toBe(false);

    app.querySelector<HTMLButtonElement>("#send-close")?.click();
    paint(app, sendFlow(status, account, preferences));
    bindTransfer(deps);

    expect(app.querySelector("#send-success")?.hasAttribute("hidden")).toBe(false);
    expect(app.querySelector("#send-success-hash")?.textContent).toBe("0xdeadbeef");
  });
});
