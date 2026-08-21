/**
 * An error toast carries a copy control for bug reports, and swipe-to-dismiss
 * must not eat its click: capturing the pointer on the toast retargets the
 * click away from the button, which reads to the user as a dead icon. Pressing
 * a control inside the toast therefore never starts a swipe, while a press on
 * the toast body still does.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { showToast } from "../../../src/sidepanel/shared/dom";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const TECHNICAL_ERROR = "strk20 private submission unavailable: relay rejected 0x2a";
const FEE_ERROR =
  "RPC: starknet_addInvokeTransaction with params {...} 55: Account validation failed: Resource bounds were not satisfied: Max L1DataGas price (235129044270) is lower than the actual gas price: 863576035385.";

const captures: unknown[] = [];

beforeEach(() => {
  document.body.replaceChildren();
  captures.length = 0;
  Element.prototype.setPointerCapture = function capture(pointerId: number): void {
    captures.push(pointerId);
  };
});

const pointerDown = (target: Element): void => {
  const event = new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 10 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
};

const toastEl = (): HTMLElement => {
  const toast = document.querySelector<HTMLElement>(".toast");
  if (!toast) {
    throw new Error("toast not rendered");
  }
  return toast;
};

describe("error toast copy control", () => {
  test("every error toast is copyable, including friendly mapped errors", () => {
    showToast("Failed to fetch", "error", document);

    expect(
      toastEl().querySelector<HTMLButtonElement>(".toast-copy")?.getAttribute("aria-label"),
    ).toBe("Copy error details");
  });

  test("shows the fee failure as one line and copies the complete RPC diagnostic", async () => {
    const copied: string[] = [];
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => copied.push(value) },
    });

    showToast("Not submitted — network fees changed.", "error", document, FEE_ERROR);
    expect(toastEl().querySelector(".toast-text")?.textContent).toBe(
      "Not submitted — network fees changed.",
    );
    toastEl().querySelector<HTMLButtonElement>(".toast-copy")?.click();
    await Promise.resolve();

    expect(copied).toEqual([FEE_ERROR]);
  });

  test("renders in the document that owns the triggering control", () => {
    const isolated = document.implementation.createHTMLDocument("Wallet frame");
    const trigger = isolated.createElement("button");
    isolated.body.append(trigger);

    showToast("Wallet frame error", "error", trigger);

    expect(isolated.querySelector("#toast-stack .toast.error")).not.toBeNull();
    expect(document.querySelector("#toast-stack")).toBeNull();
  });

  test("a press on the copy button never captures the pointer", () => {
    showToast(TECHNICAL_ERROR, "error", document);
    const copy = toastEl().querySelector<HTMLButtonElement>(".toast-copy");
    if (!copy) {
      throw new Error("copy control not rendered");
    }

    pointerDown(copy);

    // Nothing captured: the click reaches the button and the copy happens.
    expect(captures).toEqual([]);
  });

  test("a press on the toast body still starts a swipe", () => {
    showToast(TECHNICAL_ERROR, "error", document);
    const text = toastEl().querySelector(".toast-text");
    if (!text) {
      throw new Error("toast text not rendered");
    }

    pointerDown(text);

    expect(captures).toEqual([1]);
  });
});
