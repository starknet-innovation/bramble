/**
 * The reviewed recipient is shown truncated, so the review fact carries a copy
 * control for the full canonical address. The review summary is painted after
 * the shell's copy binding ran, so the transfer renderer binds it itself —
 * exactly once, with the shared clipboard feedback.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { bindTransfer } from "../../../../src/sidepanel/journeys/send/transfer-ui";
import { accountLabel } from "../../../../src/sidepanel/shared/parts";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flush,
  mountTransferUi as mount,
  TRANSFER_RECIPIENT as RECIPIENT,
  setTransferField as setField,
  submitTransferForm as submit,
} from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const originalSetTimeout = globalThis.setTimeout;
// The composed recipient is canonicalised as it leaves the form; that spelling
// is what the background signs, so it is the one the control copies.
const CANONICAL = canonicalFelt(RECIPIENT) ?? RECIPIENT;

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

const review = async (): Promise<HTMLElement> => {
  const { app, deps } = mount();
  bindTransfer(deps);
  setField(app, "recipient", RECIPIENT);
  setField(app, "amount", "1");
  submit(app);
  await flush();
  return app;
};

describe("send review recipient copy", () => {
  test("shows the recipient truncated and copies it in full", async () => {
    const app = await review();
    const fact = app
      .querySelector("#send-review-summary [data-copy]")
      ?.closest(".send-review-address");
    const code = fact?.querySelector("code");
    const copy = fact?.querySelector<HTMLButtonElement>("[data-copy]");

    expect(CANONICAL).not.toBe(RECIPIENT);
    expect(code?.textContent).toBe(accountLabel(CANONICAL));
    expect(code?.textContent).not.toBe(CANONICAL);
    expect(code?.getAttribute("title")).toBe(CANONICAL);
    expect(copy?.dataset["copy"]).toBe(CANONICAL);
    expect(copy?.getAttribute("aria-label")).toBe("Copy recipient address");
    expect(copy?.classList.contains("copy-inline")).toBe(true);
    // Never nested inside another control.
    expect(copy?.closest("button:not([data-copy]), a")).toBeNull();
  });

  test("writes the full address to the clipboard once and confirms", async () => {
    const copied: string[] = [];
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => copied.push(value) },
    });
    const app = await review();
    const copy = app.querySelector<HTMLButtonElement>("#send-review-summary [data-copy]");
    if (!copy) throw new Error("copy control missing");

    copy.click();
    await flush();

    expect(copied).toEqual([CANONICAL]);
    // Feedback lands in the screen's own status line (the review lives inside a
    // section), never as a second binding's duplicate.
    expect(app.querySelector("#transfer-result")?.textContent).toBe("Copied");
    // The working stage is a live-region container in the same section; the
    // feedback must never have replaced its markup.
    expect(app.querySelector("#send-working-title")?.textContent).toBe("Authorizing transaction");
  });
});
