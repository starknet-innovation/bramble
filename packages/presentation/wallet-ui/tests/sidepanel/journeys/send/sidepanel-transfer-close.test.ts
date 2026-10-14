/**
 * What closing Send keeps and what it discards: a composition is abandoned so
 * the next visit starts clean, while a submitted transaction stays reachable
 * because the user may come back for its receipt.
 *
 * Split from `sidepanel-transfer-ui.test.ts` to keep both files within the
 * file-length standard; the harness and the bindings under test are the same.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account, secondAccount } from "@bramble/testkit/sidepanel";
import { sendFlow } from "../../../../src/sidepanel/app/screens/flows";
import { bindTransfer } from "../../../../src/sidepanel/journeys/send/transfer-ui";
import { accountLabel } from "../../../../src/sidepanel/shared/parts";
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
    expect(app.querySelector("#send-success-hash")?.textContent).toBe(accountLabel("0xdeadbeef"));
    expect(app.querySelector("#send-success-hash")?.getAttribute("title")).toBe("0xdeadbeef");
  });

  // Audit M2: a send past the confirm has no hash yet while it signs (and, from
  // an undeployed account, while the deploy is awaited), but the background
  // still broadcasts it. Closing Send then must not reopen it on a fresh form
  // the user can send again from, and the late hash must still land.
  for (const control of ["#send-close", "#send-header-back"]) {
    test(`keeps a send that is still signing when ${control} is pressed`, async () => {
      let settle: (hash: string) => void = () => undefined;
      const pending = new Promise<string>((resolve) => {
        settle = resolve;
      });
      const { app, deps } = mount({ submitTransfer: async () => pending });
      bindTransfer(deps);
      setField(app, "recipient", RECIPIENT);
      setField(app, "amount", "1");
      submit(app);
      await flush();
      submit(app);
      await flush();
      expect(app.querySelector("#send-working")?.hasAttribute("hidden")).toBe(false);

      app.querySelector<HTMLButtonElement>(control)?.click();
      paint(app, '<main class="screen"><h1>Home</h1></main>');
      bindTransfer(deps);
      paint(app, sendFlow(status, account, preferences));
      bindTransfer(deps);

      // The in-flight send, not a fresh form.
      expect(app.querySelector("#send-recipient-stage")?.hasAttribute("hidden")).toBe(true);
      expect(app.querySelector("#send-working")?.hasAttribute("hidden")).toBe(false);

      settle("0xdeadbeef");
      await flush();
      expect(app.querySelector("#send-success")?.hasAttribute("hidden")).toBe(false);
      expect(app.querySelector("#send-success-hash")?.getAttribute("title")).toBe("0xdeadbeef");
    });
  }

  // Review follow-up to M2: an account switch or a remount also rebinds Send, and
  // must not reset a send that is still going out either.
  const signingSend = async () => {
    let settle: (hash: string) => void = () => undefined;
    const pending = new Promise<string>((resolve) => {
      settle = resolve;
    });
    const mounted = mount({ submitTransfer: async () => pending });
    bindTransfer(mounted.deps);
    setField(mounted.app, "recipient", RECIPIENT);
    setField(mounted.app, "amount", "1");
    submit(mounted.app);
    await flush();
    submit(mounted.app);
    await flush();
    expect(mounted.app.querySelector("#send-working")?.hasAttribute("hidden")).toBe(false);
    return { ...mounted, settle: (hash: string) => settle(hash) };
  };

  test("keeps a signing send across a switch to another account and back", async () => {
    const { app, deps, settle } = await signingSend();
    paint(app, sendFlow(status, secondAccount, preferences));
    bindTransfer(deps);
    paint(app, sendFlow(status, account, preferences));
    bindTransfer(deps);

    expect(app.querySelector("#send-recipient-stage")?.hasAttribute("hidden")).toBe(true);
    expect(app.querySelector("#send-working")?.hasAttribute("hidden")).toBe(false);
    settle("0xdeadbeef");
    await flush();
    expect(app.querySelector("#send-success-hash")?.getAttribute("title")).toBe("0xdeadbeef");
  });

  test("keeps a signing send when Send remounts in a new panel root", async () => {
    const { deps, settle } = await signingSend();
    const root = document.createElement("div");
    paint(root, sendFlow(status, account, preferences));
    document.body.append(root);
    bindTransfer({ ...deps, app: root });

    expect(root.querySelector("#send-recipient-stage")?.hasAttribute("hidden")).toBe(true);
    expect(root.querySelector("#send-working")?.hasAttribute("hidden")).toBe(false);
    settle("0xdeadbeef");
    await flush();
    expect(root.querySelector("#send-success-hash")?.getAttribute("title")).toBe("0xdeadbeef");
  });
});
