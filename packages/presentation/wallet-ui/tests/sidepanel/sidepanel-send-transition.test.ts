/**
 * Send-stage transition checks: unsupported browsers update immediately, while
 * supported transitions expose stable direction metadata and interruption-safe
 * cleanup.
 */
import { describe, expect, test } from "bun:test";
import { transitionProposalStage, transitionSendStage } from "../../src/sidepanel/send-transition";

type Deferred = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
};

const deferred = (): Deferred => {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const fakeDocument = (
  finished?: () => Promise<void>,
): {
  readonly dataset: DOMStringMap;
  readonly document: Document;
} => {
  const dataset = {} as DOMStringMap;
  return {
    dataset,
    document: {
      documentElement: { dataset },
      ...(finished
        ? {
            startViewTransition(callback: () => void) {
              callback();
              return { finished: finished() };
            },
          }
        : {}),
    } as unknown as Document,
  };
};

describe("transitionSendStage", () => {
  test("applies the update directly when the API is unavailable", () => {
    const view = fakeDocument();
    let updates = 0;
    transitionSendStage(view.document, "details", "reviewing", () => {
      updates += 1;
    });
    expect(updates).toBe(1);
    expect(view.dataset["sendTransition"]).toBeUndefined();
  });

  test("sets forward and back direction and does not let stale cleanup win", async () => {
    const completions = [deferred(), deferred()];
    let transitionIndex = 0;
    const view = fakeDocument(() => completions[transitionIndex++]?.promise ?? Promise.resolve());
    let updates = 0;

    transitionSendStage(view.document, "details", "reviewing", () => {
      updates += 1;
    });
    expect(view.dataset["sendTransition"]).toBe("forward");

    transitionSendStage(view.document, "review", "details", () => {
      updates += 1;
    });
    expect(view.dataset["sendTransition"]).toBe("back");
    completions[0]?.resolve();
    await Promise.resolve();
    expect(view.dataset["sendTransition"]).toBe("back");

    completions[1]?.resolve();
    await Promise.resolve();
    expect(view.dataset["sendTransition"]).toBeUndefined();
    expect(updates).toBe(2);
  });
});

describe("transitionProposalStage", () => {
  test("keeps recipient, amount, picker, and review movement spatially consistent", async () => {
    const completion = deferred();
    const view = fakeDocument(() => completion.promise);
    let updates = 0;
    transitionProposalStage(view.document, "recipient", "amount", () => {
      updates += 1;
    });
    expect(view.dataset["proposalTransition"]).toBe("forward");
    completion.resolve();
    await Promise.resolve();
    expect(view.dataset["proposalTransition"]).toBeUndefined();
    expect(updates).toBe(1);
  });
});
