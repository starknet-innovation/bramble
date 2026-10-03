/**
 * Audit #248: Enter in the recipient search must never
 * fall through to implicit submission of `#transfer-form`, which reviewed the
 * PREVIOUSLY chosen hidden recipient. And stepping Back to the recipient stage
 * clears that hidden recipient, so no review can be built from an address the
 * current step no longer shows. The shared token dropdown's Enter handling is
 * pinned in ../swap/swap-token-dropdown.test.ts (the same binding Send uses).
 *
 * The amount step asks for an estimate now (the fee preview), so arriving there
 * with an amount is one review request rather than none; the guard is that this
 * request, like any other, carries the address on screen and never the poison.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { sameFelt } from "@bramble/wallet-model/networks";
import { bindTransfer } from "../../../../src/sidepanel/journeys/send/transfer-ui";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flush,
  mountTransferUi as mount,
  setTransferField as setField,
  submitTransferForm as submit,
} from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const POISON = "0x049d3ff111111111111111111111111111111111111111111111111111119f1e";
const GENUINE = "0x049d3aa7890abcdef1234567890abcdef1234567890abcdef1234567890a9f1e";
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

const hidden = (app: HTMLElement, name: string): string =>
  app.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ?? "";

const typeRecipient = (app: HTMLElement, text: string): HTMLInputElement => {
  const search = app.querySelector<HTMLInputElement>("#send-recipient-search");
  if (!search) throw new Error("recipient search missing");
  search.value = text;
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  return search;
};

const pressEnter = (field: HTMLElement): KeyboardEvent => {
  const event = new window.KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Enter",
  });
  field.dispatchEvent(event);
  return event as unknown as KeyboardEvent;
};

const chooseThenGoBack = (app: HTMLElement): void => {
  typeRecipient(app, POISON);
  app.querySelector<HTMLButtonElement>("#send-recipient-continue")?.click();
  expect(sameFelt(hidden(app, "recipient"), POISON)).toBe(true);
  setField(app, "amount", "1");
  document.querySelector<HTMLButtonElement>("#send-header-back")?.click();
};

describe("recipient search Enter (audit #248)", () => {
  test("Enter commits the address on screen, not the previous choice", async () => {
    const { app, calls, deps } = mount();
    bindTransfer(deps);
    chooseThenGoBack(app);
    const form = app.querySelector<HTMLFormElement>("#transfer-form");
    expect(form?.dataset["stage"]).toBe("recipient");

    const event = pressEnter(typeRecipient(app, GENUINE));
    await flush();

    expect(event.defaultPrevented).toBe(true);
    expect(sameFelt(hidden(app, "recipient"), GENUINE)).toBe(true);
    expect(form?.dataset["stage"]).toBe("details");
    // The amount step's fee estimate is the one request expected here, and it
    // must name the address on screen, never the previous choice.
    expect(calls.reviewTransfer).toHaveLength(1);
    expect(sameFelt(String(calls.reviewTransfer[0]?.[2]), GENUINE)).toBe(true);
    expect(sameFelt(String(calls.reviewTransfer[0]?.[2]), POISON)).toBe(false);
  });

  test("Back clears the hidden recipient so a stray submit reviews nothing", async () => {
    const { app, calls, deps } = mount();
    bindTransfer(deps);
    chooseThenGoBack(app);

    expect(hidden(app, "recipient")).toBe("");
    expect(hidden(app, "recipientLabel")).toBe("");
    submit(app);
    await flush();
    expect(calls.reviewTransfer).toHaveLength(0);
  });

  test("Enter on an invalid entry stays on the recipient step", async () => {
    const { app, calls, deps } = mount();
    bindTransfer(deps);
    const event = pressEnter(typeRecipient(app, "not-an-address"));
    await flush();
    expect(event.defaultPrevented).toBe(true);
    expect(app.querySelector<HTMLFormElement>("#transfer-form")?.dataset["stage"]).not.toBe(
      "details",
    );
    // Still on the recipient step, so nothing is composed and nothing is estimated.
    expect(calls.reviewTransfer).toHaveLength(0);
  });
});
