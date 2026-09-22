/**
 * Onboarding step transitions must not leave the page covered when the browser
 * never settles the view transition.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createOnboardingStepTransition } from "../../../../src/sidepanel/journeys/onboarding/onboarding-transition";

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("onboarding step transition", () => {
  beforeEach(() => {
    GlobalRegistrator.register();
    document.body.className = "onboarding-surface";
    window.matchMedia = ((query: string) =>
      ({
        addEventListener: () => undefined,
        dispatchEvent: () => false,
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  });

  afterEach(async () => {
    await GlobalRegistrator.unregister();
  });

  test("drops the overlay when the view transition never finishes", async () => {
    const current = document.createElement("section");
    const next = document.createElement("section");
    next.hidden = true;
    document.body.append(current, next);
    let skipped = false;
    const owner = document as unknown as {
      startViewTransition: (callback: () => void) => {
        readonly finished: Promise<void>;
        readonly skipTransition: () => void;
      };
    };
    owner.startViewTransition = (callback) => {
      callback();
      return {
        finished: new Promise(() => undefined),
        skipTransition: () => {
          skipped = true;
        },
      };
    };

    createOnboardingStepTransition(document.body, [current, next])(next, "forward");

    expect(document.documentElement.dataset["onboardingDirection"]).toBe("forward");
    expect(next.hidden).toBe(false);
    await wait(1_100);
    expect(skipped).toBe(true);
    expect(document.documentElement.dataset["onboardingDirection"]).toBeUndefined();
  });
});
