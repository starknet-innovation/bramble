/**
 * Directional step transitions for full-page onboarding. The browser canvas
 * and wizard shell stay fixed while Chrome snapshots only the active step.
 *
 * ─────────────────────────────────────────────────────────
 * ONBOARDING TRANSITION STORYBOARD
 *
 *    0ms   current step remains visible while Chrome captures it
 *    0ms   next step replaces it inside the stable wizard stage
 *  210ms   outgoing step has faded and travelled 18px
 *  300ms   incoming step settles from 28px with focus restored
 * ─────────────────────────────────────────────────────────
 */
import { prefersReducedMotion } from "./motion";

/**
 * Spatial direction of a first-run step change.
 */
export type OnboardingDirection = "back" | "forward";

type OnboardingViewTransition = {
  readonly finished: Promise<void>;
  readonly skipTransition?: () => void;
};

type OnboardingTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => OnboardingViewTransition;
};

/**
 * Creates one interruptible transition owner for a staged onboarding page.
 * Unsupported and reduced-motion environments cut directly to the next step.
 */
export const createOnboardingStepTransition = (
  app: Element | null,
  steps: readonly HTMLElement[],
): ((next: HTMLElement, direction: OnboardingDirection) => void) => {
  const ownerDocument = (app?.ownerDocument ?? document) as OnboardingTransitionDocument;
  let activeTransition: OnboardingViewTransition | null = null;
  let transitionGeneration = 0;

  const reveal = (next: HTMLElement, direction: OnboardingDirection): void => {
    const target = next;
    for (const step of steps) {
      step.classList.remove("is-entering");
      delete step.dataset["onboardingEnter"];
      step.hidden = step !== target;
    }
    target.dataset["onboardingEnter"] = direction;
  };
  const focus = (next: HTMLElement): void => {
    const target = next;
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  };

  return (next, direction) => {
    const root = ownerDocument.documentElement;
    const canTransition =
      ownerDocument.body.classList.contains("onboarding-surface") &&
      !prefersReducedMotion() &&
      typeof ownerDocument.startViewTransition === "function";
    if (!canTransition) {
      reveal(next, direction);
      next.classList.add("is-entering");
      focus(next);
      return;
    }

    activeTransition?.skipTransition?.();
    const generation = ++transitionGeneration;
    root.dataset["onboardingDirection"] = direction;
    const transition = ownerDocument.startViewTransition?.(() => reveal(next, direction));
    if (!transition) {
      reveal(next, direction);
      focus(next);
      return;
    }
    activeTransition = transition;
    const finish = (): void => {
      if (generation !== transitionGeneration) {
        return;
      }
      activeTransition = null;
      delete root.dataset["onboardingDirection"];
      focus(next);
    };
    void transition.finished.then(finish, finish);
  };
};
