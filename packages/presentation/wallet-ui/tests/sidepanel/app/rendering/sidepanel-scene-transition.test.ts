/** Full-scene transition metadata remains owned by the newest navigation. */
import { describe, expect, test } from "bun:test";
import { transitionScene } from "../../../../src/sidepanel/app/rendering/scene-transition";

const deferred = (): { readonly promise: Promise<void>; readonly resolve: () => void } => {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("transitionScene", () => {
  test("falls back directly without the View Transitions API", () => {
    const dataset = {} as DOMStringMap;
    let fallback = false;
    transitionScene({ documentElement: { dataset } } as unknown as Document, "forward", (value) => {
      fallback = value;
    });
    expect(fallback).toBe(true);
  });

  test("stale completion cannot clear a newer direction", async () => {
    const completions = [deferred(), deferred()];
    let index = 0;
    const dataset = {} as DOMStringMap;
    const doc = {
      documentElement: { dataset },
      startViewTransition(callback: () => void) {
        callback();
        return { finished: completions[index++]?.promise ?? Promise.resolve() };
      },
    } as unknown as Document;
    transitionScene(doc, "forward", () => undefined);
    transitionScene(doc, "back", () => undefined);
    completions[0]?.resolve();
    await Promise.resolve();
    expect(dataset["navDirection"]).toBe("back");
    completions[1]?.resolve();
    await Promise.resolve();
    expect(dataset["navDirection"]).toBeUndefined();
  });
});
