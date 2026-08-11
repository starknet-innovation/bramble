/**
 * Semantic live values animate only when their data changes across a repaint.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  animateLiveValueChanges,
  captureLiveValues,
} from "../../../../src/sidepanel/app/sync/live-updates";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

describe("live value updates", () => {
  test("captures keyed values and animates a changed replacement", () => {
    const root = document.createElement("div");
    root.innerHTML = '<span data-live-key="balance" data-live-value="1">1 STRK</span>';
    const previous = captureLiveValues(root);
    root.innerHTML = '<span data-live-key="balance" data-live-value="2">2 STRK</span>';
    const value = root.querySelector<HTMLElement>("[data-live-key]");
    let animationCount = 0;
    Object.assign(value ?? {}, {
      animate: () => {
        animationCount += 1;
        return { id: "" };
      },
      getAnimations: () => [],
    });

    animateLiveValueChanges(root, previous);

    expect(previous.get("balance")).toBe("1");
    expect(animationCount).toBe(1);
  });
});
