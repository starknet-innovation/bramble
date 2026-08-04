/**
 * The error toast's copy control, which had no coverage at all. Pins three
 * things: a mouse click actually reaches the button's listener (a pointerdown
 * on it must NOT start the toast's swipe capture, which retargets the following
 * click to the toast container and silently kills the button), a successful
 * write hands the clipboard the message the toast is showing, and a rejected
 * write reports on the control itself rather than spawning another toast —
 * which, being an error toast, would carry a copy button that fails the same way.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { showToast } from "../../src/sidepanel/dom";
import { registerDom, unregisterDom } from "../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

// The wallet never declares `clipboardWrite`; a gesture-driven write works
// without it, so the stub stands in for the real navigator API either way.
const stubClipboard = (writeText: (value: string) => Promise<void>): void => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
};

// An unrecognized internal string, so friendlyError keeps it verbatim and marks
// it copyable — exactly the case the copy control exists for.
const ERROR_TEXT =
  "The network could not execute this transaction (RPC error 41): Insufficient max L2Gas.";

const openErrorToast = (): HTMLButtonElement => {
  showToast(ERROR_TEXT, "error");
  const copy = document.querySelector<HTMLButtonElement>(".toast-copy");
  if (!copy) {
    throw new Error("error toast rendered no copy control");
  }
  return copy;
};

// happy-dom has no pointer capture; the spy both supplies it and records
// whether the swipe binding tried to capture from inside the button.
const spyPointerCapture = (): readonly number[] => {
  const captured: number[] = [];
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto["setPointerCapture"] = (pointerId: number) => captured.push(pointerId);
  proto["hasPointerCapture"] = () => false;
  proto["releasePointerCapture"] = () => undefined;
  return captured;
};

// happy-dom ships no PointerEvent, so the pointer fields the swipe binding
// reads are defined onto a plain Event (Event supplies timeStamp itself).
const pointerDown = (target: Element): void => {
  const event = new window.Event("pointerdown", { bubbles: true, cancelable: true });
  for (const [key, value] of [
    ["button", 0],
    ["clientX", 10],
    ["pointerId", 1],
  ] as const) {
    Object.defineProperty(event, key, { configurable: true, value });
  }
  target.dispatchEvent(event);
};

afterEach(() => {
  document.querySelector("#toast-stack")?.remove();
});

describe("error toast copy control", () => {
  test("a pointerdown on the copy button does not start the toast swipe capture", () => {
    const captured = spyPointerCapture();
    const copy = openErrorToast();

    pointerDown(copy);
    expect(captured).toEqual([]);

    // Swipe-to-dismiss still starts from the toast's own text.
    const text = document.querySelector(".toast-text");
    if (!text) {
      throw new Error("error toast rendered no text");
    }
    pointerDown(text);
    expect(captured).toEqual([1]);
  });

  test("clicking copy writes the toast's message to the clipboard", async () => {
    const written: string[] = [];
    stubClipboard(async (value) => {
      written.push(value);
    });
    const copy = openErrorToast();

    copy.click();
    await Promise.resolve();

    expect(written).toEqual([ERROR_TEXT]);
    expect(copy.getAttribute("aria-label")).toBe("Error message copied");
    expect(copy.title).toBe("Error message copied");
  });

  test("a rejected write reports on the control instead of spawning a toast", async () => {
    stubClipboard(() => Promise.reject(new Error("NotAllowedError")));
    const copy = openErrorToast();
    const toastsBefore = document.querySelectorAll(".toast").length;

    copy.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(copy.getAttribute("aria-label")).toBe("Copy failed");
    expect(copy.title).toBe("Copy failed");
    expect(document.querySelectorAll(".toast").length).toBe(toastsBefore);
  });
});
