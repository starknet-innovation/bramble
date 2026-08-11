/**
 * An error toast carries a copy control for bug reports, and swipe-to-dismiss
 * must not eat its click: capturing the pointer on the toast retargets the
 * click away from the button, which reads to the user as a dead icon. Pressing
 * a control inside the toast therefore never starts a swipe, while a press on
 * the toast body still does.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { showToast } from "../../src/sidepanel/dom";
import { registerDom, unregisterDom } from "../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

// A copyable error: friendlyError marks unrecognized technical text copyable, so
// the toast renders its copy button.
const TECHNICAL_ERROR = "strk20 private submission unavailable: relay rejected 0x2a";

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
  test("a press on the copy button never captures the pointer", () => {
    showToast(TECHNICAL_ERROR, "error");
    const copy = toastEl().querySelector<HTMLButtonElement>(".toast-copy");
    if (!copy) {
      throw new Error("copy control not rendered");
    }

    pointerDown(copy);

    // Nothing captured: the click reaches the button and the copy happens.
    expect(captures).toEqual([]);
  });

  test("a press on the toast body still starts a swipe", () => {
    showToast(TECHNICAL_ERROR, "error");
    const text = toastEl().querySelector(".toast-text");
    if (!text) {
      throw new Error("toast text not rendered");
    }

    pointerDown(text);

    expect(captures).toEqual([1]);
  });
});
