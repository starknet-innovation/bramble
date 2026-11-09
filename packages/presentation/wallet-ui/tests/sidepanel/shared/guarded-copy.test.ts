/**
 * The guarded phrase copy keeps its clipboard promise (mc-wallet #473): only
 * the latest copy's timer clears the clipboard, a refused clear is reported
 * and never treated as a clear, and a browser that cannot clear (Firefox
 * extension pages) is never promised one.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  bindGuardedCopy,
  closeAfterGuardedClear,
  GUARDED_COPY_CLEAR_MS,
  GUARDED_COPY_NOTE,
  GUARDED_COPY_NOTE_NO_CLEAR,
  guardedCopyClearIsPending,
  guardedCopyNote,
  guardedCopyPendingClear,
  resetGuardedCopyClearForTests,
} from "../../../src/sidepanel/shared/guarded-copy";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type HappyWindow = { readonly happyDOM: { readonly setURL: (url: string) => void } };
const setUrl = (url: string): void => (window as unknown as HappyWindow).happyDOM.setURL(url);

let copied: string[] = [];
let clears: Array<() => void> = [];
let rejectClear = false;
let realSetTimeout: typeof window.setTimeout;

beforeEach(() => {
  document.body.replaceChildren();
  copied = [];
  clears = [];
  rejectClear = false;
  resetGuardedCopyClearForTests();
  realSetTimeout = window.setTimeout;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        if (value === "" && rejectClear) {
          throw new Error("Document is not focused");
        }
        copied.push(value);
      },
    },
  });
  Object.defineProperty(window, "setTimeout", {
    configurable: true,
    value: (callback: () => void, delay?: number) => {
      if (delay === GUARDED_COPY_CLEAR_MS) {
        clears.push(callback);
        return 0;
      }
      return realSetTimeout(callback, delay);
    },
  });
});

afterEach(() => {
  Object.defineProperty(window, "setTimeout", { configurable: true, value: realSetTimeout });
  setUrl("about:blank");
});

/** A copy control whose live text is whatever `text.value` holds at click time. */
const control = (): { readonly button: HTMLButtonElement; readonly text: { value: string } } => {
  const button = document.createElement("button");
  document.body.append(button);
  const text = { value: "first phrase words" };
  bindGuardedCopy(button, () => text.value);
  return { button, text };
};

const toast = (kind: "error" | "success"): string =>
  Array.from(document.querySelectorAll(`.toast.${kind}`))
    .map((node) => node.textContent ?? "")
    .join(" | ");

describe("guarded copy clear", () => {
  test("an earlier timer does not clear a newer copy", async () => {
    const { button, text } = control();
    button.click();
    await tick();
    text.value = "second phrase words";
    button.click();
    await tick();
    expect(copied).toEqual(["first phrase words", "second phrase words"]);
    expect(clears).toHaveLength(2);

    // The first copy's minute is up, but the clipboard now holds the second.
    clears[0]?.();
    await tick();
    expect(copied).toEqual(["first phrase words", "second phrase words"]);
    expect(guardedCopyClearIsPending()).toBe(true);

    clears[1]?.();
    await tick();
    expect(copied).toEqual(["first phrase words", "second phrase words", ""]);
    expect(guardedCopyClearIsPending()).toBe(false);
    expect(await guardedCopyPendingClear()).toBe(true);
  });

  test("a superseded clear resolves with the newer clear's outcome", async () => {
    const { button } = control();
    button.click();
    await tick();
    const earlier = guardedCopyPendingClear();
    button.click();
    await tick();
    let settled = null as boolean | null;
    void earlier.then((cleared) => {
      settled = cleared;
    });
    clears[0]?.();
    await tick();
    expect(settled).toBeNull();
    rejectClear = true;
    clears[1]?.();
    await tick();
    await tick();
    expect(settled).toBe(false);
  });

  test("a refused clear is reported and is not a successful clear", async () => {
    const { button } = control();
    button.click();
    await tick();
    rejectClear = true;
    clears[0]?.();
    await tick();
    expect(copied).toEqual(["first phrase words"]);
    expect(await guardedCopyPendingClear()).toBe(false);
    expect(guardedCopyClearIsPending()).toBe(false);
    expect(toast("error")).toContain("Couldn't clear the clipboard");
  });
});

describe("closeAfterGuardedClear", () => {
  test("closes at once when nothing was copied", async () => {
    const status = document.createElement("p");
    let closed = 0;
    closeAfterGuardedClear(status, () => {
      closed += 1;
    });
    await tick();
    expect(closed).toBe(1);
    expect(status.textContent).toBe("");
  });

  test("waits for the clear, then closes", async () => {
    const { button } = control();
    button.click();
    await tick();
    const status = document.createElement("p");
    let closed = 0;
    closeAfterGuardedClear(status, () => {
      closed += 1;
    });
    await tick();
    expect(closed).toBe(0);
    expect(status.textContent).toContain("stays open until the clipboard clear finishes");
    clears[0]?.();
    await tick();
    await tick();
    expect(closed).toBe(1);
  });

  test("stays open and says so when the clear is refused", async () => {
    const { button } = control();
    button.click();
    await tick();
    const status = document.createElement("p");
    let closed = 0;
    closeAfterGuardedClear(status, () => {
      closed += 1;
    });
    rejectClear = true;
    clears[0]?.();
    await tick();
    await tick();
    expect(closed).toBe(0);
    expect(status.textContent).toContain("Couldn't clear the clipboard");
  });
});

describe("browsers that cannot clear the clipboard", () => {
  test("a Firefox extension page copies without promising or scheduling a clear", async () => {
    setUrl("moz-extension://bramble/sidepanel.html");
    const { button } = control();
    button.click();
    await tick();
    expect(copied).toEqual(["first phrase words"]);
    expect(clears).toHaveLength(0);
    expect(guardedCopyClearIsPending()).toBe(false);
    expect(toast("success")).not.toContain("cleared");
    expect(toast("success")).toContain("copy something else");
    expect(guardedCopyNote(window as unknown as Window)).toBe(GUARDED_COPY_NOTE_NO_CLEAR);
    // The phrase is still on the clipboard, so it is never reported as cleared.
    expect(await guardedCopyPendingClear()).toBe(false);
  });

  test("onboarding completion does not close silently after a Firefox copy", async () => {
    setUrl("moz-extension://bramble/onboarding.html");
    const { button } = control();
    button.click();
    await tick();
    const status = document.createElement("p");
    let closed = 0;
    closeAfterGuardedClear(status, () => {
      closed += 1;
    });
    await tick();
    expect(closed).toBe(0);
    expect(status.textContent).toBe(
      "Couldn't clear the clipboard. Copy something else to overwrite it. Then close this tab.",
    );
  });

  test("a Firefox copy supersedes an older pending clear's outcome", async () => {
    setUrl("chrome-extension://bramble/onboarding.html");
    const { button } = control();
    button.click();
    await tick();
    setUrl("moz-extension://bramble/onboarding.html");
    button.click();
    await tick();
    // The older timer must neither clear the newer copy nor report it cleared.
    clears[0]?.();
    await tick();
    expect(copied).toEqual(["first phrase words", "first phrase words"]);
    expect(guardedCopyClearIsPending()).toBe(false);
    expect(await guardedCopyPendingClear()).toBe(false);
  });

  test("a Chromium extension page keeps the one-minute clear and its note", () => {
    setUrl("chrome-extension://bramble/sidepanel.html");
    expect(guardedCopyNote(window as unknown as Window)).toBe(GUARDED_COPY_NOTE);
    // Both warnings keep the facts the copy review dropped from Reveal.
    for (const note of [GUARDED_COPY_NOTE, GUARDED_COPY_NOTE_NO_CLEAR]) {
      expect(note).toContain("Other apps can read the clipboard");
      expect(note).toContain("sync to your other devices");
    }
  });
});
