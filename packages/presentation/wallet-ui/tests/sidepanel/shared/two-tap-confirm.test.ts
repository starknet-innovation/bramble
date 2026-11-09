/**
 * Two-tap confirmation: the first tap arms and says so, a second tap within
 * the window confirms, and an armed control disarms after the window, on blur
 * or on Escape, restoring its content, accessible name and title.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { confirmSecondTap, TWO_TAP_WINDOW_MS } from "../../../src/sidepanel/shared/two-tap-confirm";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const LABEL = "Tap again to remove";

const mountButton = (): HTMLButtonElement => {
  const control = document.createElement("button");
  const glyph = document.createElement("span");
  glyph.className = "glyph";
  control.append(glyph, "Remove");
  control.title = "Remove this NFT";
  document.body.append(control);
  return control;
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const expectDisarmed = (control: HTMLButtonElement): void => {
  expect(control.dataset["confirm"]).toBeUndefined();
  expect(control.classList.contains("is-confirming")).toBe(false);
  expect(control.hasAttribute("aria-label")).toBe(false);
  expect(control.title).toBe("Remove this NFT");
  expect(control.textContent).toBe("Remove");
  expect(control.querySelector(".glyph")).not.toBeNull();
};

describe("confirmSecondTap", () => {
  test("the window is about four seconds", () => {
    expect(TWO_TAP_WINDOW_MS).toBe(4_000);
  });

  test("first tap arms and says so; a second tap within the window confirms", () => {
    const control = mountButton();
    expect(confirmSecondTap(control, { label: LABEL, replaceContent: true })).toBe(false);
    expect(control.textContent).toBe(LABEL);
    expect(control.getAttribute("aria-label")).toBe(LABEL);
    expect(control.title).toBe(LABEL);
    expect(confirmSecondTap(control, { label: LABEL, replaceContent: true })).toBe(true);
    // Confirming disarms at once: if the action then fails and the control is
    // enabled again, a later single tap only arms it again.
    expectDisarmed(control);
    expect(confirmSecondTap(control, { label: LABEL, replaceContent: true })).toBe(false);
  });

  test("a second tap after the window arms again instead of confirming", async () => {
    const control = mountButton();
    confirmSecondTap(control, { label: LABEL, replaceContent: true, windowMs: 10 });
    await wait(30);
    expectDisarmed(control);
    expect(confirmSecondTap(control, { label: LABEL, replaceContent: true, windowMs: 10 })).toBe(
      false,
    );
  });

  test("blur and Escape disarm and restore the original control", () => {
    const blurred = mountButton();
    confirmSecondTap(blurred, { label: LABEL, replaceContent: true });
    blurred.dispatchEvent(new Event("blur"));
    expectDisarmed(blurred);
    expect(confirmSecondTap(blurred, { label: LABEL, replaceContent: true })).toBe(false);

    const escaped = mountButton();
    confirmSecondTap(escaped, { label: LABEL, replaceContent: true });
    escaped.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(escaped.dataset["confirm"]).toBe("true");
    escaped.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expectDisarmed(escaped);
  });

  test("an icon-only control keeps its content and carries the label as its name", () => {
    const control = mountButton();
    confirmSecondTap(control, { label: "Tap again to delete", replaceContent: false });
    expect(control.textContent).toBe("Remove");
    expect(control.getAttribute("aria-label")).toBe("Tap again to delete");
    control.dispatchEvent(new Event("blur"));
    expectDisarmed(control);
  });
});
