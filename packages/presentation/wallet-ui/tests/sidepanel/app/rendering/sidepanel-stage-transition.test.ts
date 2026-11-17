/**
 * A View Transition the browser aborts (Chrome's "Transition was aborted
 * because of timeout in DOM update") rejects `ready` and `updateCallbackDone`.
 * The stage and scene wrappers must observe both, so the abort never surfaces
 * as an unhandled rejection, while the DOM update still commits.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { transitionScene } from "../../../../src/sidepanel/app/rendering/scene-transition";
import { transitionTaskStage } from "../../../../src/sidepanel/app/rendering/stage-transition";

const unhandled: unknown[] = [];
const record = (reason: unknown): void => {
  unhandled.push(reason);
};

const abortedDocument = (): Document => {
  const dataset = {} as DOMStringMap;
  return {
    documentElement: { dataset },
    startViewTransition(callback: () => void) {
      callback();
      const timeout = (): Promise<void> =>
        Promise.reject(new Error("Transition was aborted because of timeout in DOM update"));
      return { finished: Promise.resolve(), ready: timeout(), updateCallbackDone: timeout() };
    },
  } as unknown as Document;
};

// Two macrotask turns: long enough for the runtime to report a rejection
// that nothing observed.
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("aborted view transitions", () => {
  beforeEach(() => {
    unhandled.length = 0;
    process.on("unhandledRejection", record);
  });
  afterEach(() => {
    process.off("unhandledRejection", record);
  });

  test("a task stage commits and leaves no unhandled rejection", async () => {
    const doc = abortedDocument();
    let updated = false;
    transitionTaskStage(doc, "a", "b", { a: 0, b: 1 }, "stageKey", "stageIdKey", () => {
      updated = true;
    });
    await settle();
    expect(updated).toBe(true);
    expect(unhandled).toEqual([]);
    expect(doc.documentElement.dataset["stageKey"]).toBeUndefined();
  });

  test("a scene commits and leaves no unhandled rejection", async () => {
    const doc = abortedDocument();
    const commits: boolean[] = [];
    transitionScene(doc, "forward", (fallback) => {
      commits.push(fallback);
    });
    await settle();
    expect(commits).toEqual([false]);
    expect(unhandled).toEqual([]);
    expect(doc.documentElement.dataset["navDirection"]).toBeUndefined();
  });
});
