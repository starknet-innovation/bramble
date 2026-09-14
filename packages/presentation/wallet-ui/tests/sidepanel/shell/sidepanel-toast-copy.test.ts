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

  test("shows compact copy and copies the complete RPC diagnostic", async () => {
    const copied: string[] = [];
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => copied.push(value) },
    });

    showToast(FEE_ERROR, "error", document);
    expect(toastEl().querySelector(".toast-text")?.textContent).toBe(
      "The RPC rejected this request. Copy the error details for the full response.",
    );
    toastEl().querySelector<HTMLButtonElement>(".toast-copy")?.click();
    await Promise.resolve();

    expect(copied).toEqual([FEE_ERROR]);
    expect(toastEl().querySelector(".toast-copy")?.getAttribute("aria-label")).toBe(
      "Error details copied",
    );
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

// What the clipboard actually receives. The reported bug was that copying a
// failed transaction yielded only "invoke request failed" — the toast had no
// access to the node's reason, so there was nothing else to give.
describe("error toast copy payload", () => {
  const copied: string[] = [];

  const stubClipboard = (): void => {
    copied.length = 0;
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(text: string) {
          copied.push(text);
        },
      },
    });
  };

  const clickCopy = (): void => {
    const copy = toastEl().querySelector<HTMLButtonElement>(".toast-copy");
    if (!copy) {
      throw new Error("copy control not rendered");
    }
    copy.click();
  };

  test("copies the message plus the detail, while the toast shows only the message", async () => {
    stubClipboard();
    const detail = "Account balance is smaller than the transaction's max_fee";
    showToast("invoke request failed", "error", document, `invoke request failed\n\n${detail}`);

    // The toast body stays short — a node's rejection is unreadable in a toast.
    expect(toastEl().querySelector(".toast-text")?.textContent).toBe("invoke request failed");
    clickCopy();
    await Promise.resolve();

    // The clipboard gets both, so a bug report carries the actual reason.
    expect(copied).toEqual([`invoke request failed\n\n${detail}`]);
  });

  test("a detail earns a copy control even for an otherwise non-copyable message", async () => {
    stubClipboard();
    // "wallet unavailable" maps to friendly copy that is deliberately
    // non-copyable; a real diagnostic alongside it still deserves the control.
    showToast(
      "wallet unavailable",
      "error",
      document,
      "wallet unavailable\n\nsession expired mid-broadcast",
    );
    clickCopy();
    await Promise.resolve();

    expect(copied).toEqual(["wallet unavailable\n\nsession expired mid-broadcast"]);
  });

  test("without a detail it still copies the message alone", async () => {
    stubClipboard();
    showToast(TECHNICAL_ERROR, "error", document);
    clickCopy();
    await Promise.resolve();

    expect(copied).toEqual([TECHNICAL_ERROR]);
  });
});
