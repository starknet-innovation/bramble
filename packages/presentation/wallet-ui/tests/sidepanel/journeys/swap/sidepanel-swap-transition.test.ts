/** Swap-stage direction metadata and cleanup. */
import { describe, expect, test } from "bun:test";
import { transitionSwapStage } from "../../../../src/sidepanel/journeys/swap/swap-transition";

describe("transitionSwapStage", () => {
  test("marks review as forward and clears the marker when motion finishes", async () => {
    const dataset = {} as DOMStringMap;
    let finish = (): void => {};
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const doc = {
      documentElement: { dataset },
      startViewTransition(update: () => void) {
        update();
        return { finished };
      },
    } as unknown as Document;
    let updates = 0;

    transitionSwapStage(doc, "edit", "confirm", () => {
      updates += 1;
    });
    expect(dataset["swapTransition"]).toBe("forward");
    expect(updates).toBe(1);

    finish();
    await finished;
    await Promise.resolve();
    expect(dataset["swapTransition"]).toBeUndefined();
  });
});
