/**
 * A screen that takes over the panel mid-send (Sherlock 164).
 *
 * A dapp approval raised while a send is signing renders the approval in place
 * of Send, and the Send binder runs with no form. That used to reset the
 * journey and bump its epoch, so the hash the background returned a moment
 * later was dropped and the send looked as if it never happened. A send past
 * the confirm is now kept, and its outcome shows when Send is next opened.
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

// A submit the test settles by hand, so the takeover can land in between.
const deferredSubmit = () => {
  let settle: (hash: string) => void = () => undefined;
  const pending = new Promise<string>((resolve) => {
    settle = resolve;
  });
  return { settle, submitTransfer: async () => pending };
};

const takeOver = (app: HTMLElement, deps: Parameters<typeof bindTransfer>[0]): void => {
  paint(app, '<main class="screen"><h1>Approve request</h1></main>');
  bindTransfer(deps);
};

const reopenSend = (app: HTMLElement, deps: Parameters<typeof bindTransfer>[0]): void => {
  paint(app, sendFlow(status, account, preferences));
  bindTransfer(deps);
};

describe("a takeover while a send is signing", () => {
  test("keeps the send, so its hash lands and shows when Send is reopened", async () => {
    const { settle, submitTransfer } = deferredSubmit();
    const { app, deps } = mount({ submitTransfer });
    bindTransfer(deps);
    setField(app, "recipient", RECIPIENT);
    setField(app, "amount", "1");
    submit(app);
    await flush();
    submit(app);
    await flush();

    takeOver(app, deps);
    // The harness activity reports this hash accepted.
    settle("0xdeadbeef");
    await flush();
    reopenSend(app, deps);

    expect(app.querySelector("#send-success")?.hasAttribute("hidden")).toBe(false);
    expect(app.querySelector("#send-success-hash")?.getAttribute("title")).toBe("0xdeadbeef");
  });

  test("still discards a composition that was never confirmed", async () => {
    const { app, deps } = mount();
    bindTransfer(deps);
    setField(app, "recipient", RECIPIENT);
    setField(app, "amount", "1");
    submit(app);
    await flush();

    takeOver(app, deps);
    reopenSend(app, deps);

    expect(app.querySelector("#send-recipient-stage")?.hasAttribute("hidden")).toBe(false);
    expect(app.querySelector("#send-success")?.hasAttribute("hidden")).toBe(true);
  });
});
