/**
 * Multisig review-sheet interruption regression tests.
 * @group ui
 * @group unit
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeMultisigSheet, openMultisigSheet } from "../../src/sidepanel/multisig-sheet-motion";
import { registerDom, unregisterDom } from "../support/groups-harness";

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
