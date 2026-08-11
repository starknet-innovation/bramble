/**
 * Multisig review-sheet interruption regression tests.
 * @group ui
 * @group unit
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  closeMultisigSheet,
  openMultisigSheet,
} from "../../../../src/sidepanel/journeys/multisig/multisig-sheet-motion";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

type DeferredAnimation = {
  readonly animation: Animation;
  readonly resolve: () => void;
};

const deferredAnimation = (): DeferredAnimation => {
  let resolve = (): void => undefined;
  const finished = new Promise<void>((done) => {
    resolve = done;
  });
  const animation = {
    cancel: () => undefined,
    finished,
    id: "",
  } as unknown as Animation;
  return { animation, resolve };
};

const installAnimations = (element: HTMLElement, queue: DeferredAnimation[]): void => {
  Object.defineProperties(element, {
    animate: {
      configurable: true,
      value: () => {
        const next = deferredAnimation();
        queue.push(next);
        return next.animation;
      },
    },
    getAnimations: { configurable: true, value: () => [] },
  });
};

describe("multisig sheet motion", () => {
  test("contains keyboard focus until the modal closes", () => {
    const outside = document.createElement("button");
    const panel = document.createElement("section");
    panel.tabIndex = -1;
    panel.hidden = true;
    const card = document.createElement("div");
    card.className = "multisig-review-card";
    const first = document.createElement("button");
    const last = document.createElement("button");
    card.append(first, last);
    panel.append(card);
    document.body.append(outside, panel);

    openMultisigSheet(panel, first);
    first.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Tab", shiftKey: true }),
    );
    expect(document.activeElement).toBe(last);
    last.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));
    expect(document.activeElement).toBe(first);
    outside.focus();
    expect(document.activeElement).toBe(first);

    closeMultisigSheet(panel);
    outside.focus();
    expect(document.activeElement).toBe(outside);
    panel.remove();
    outside.remove();
  });

  test("a stale close completion cannot hide a reopened sheet", async () => {
    const panel = document.createElement("section");
    const card = document.createElement("div");
    card.className = "multisig-review-card";
    panel.append(card);
    document.body.append(panel);
    const animations: DeferredAnimation[] = [];
    installAnimations(panel, animations);
    installAnimations(card, animations);

    closeMultisigSheet(panel);
    openMultisigSheet(panel);
    animations[0]?.resolve();
    animations[1]?.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(panel.hidden).toBe(false);
    animations[2]?.resolve();
    animations[3]?.resolve();
    panel.remove();
  });
});
