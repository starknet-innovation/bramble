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
import { prefersReducedMotion } from "../../shared/motion";

/**
 * Spatial direction of a first-run step change.
 */
export type OnboardingDirection = "back" | "forward";

type OnboardingViewTransition = {
  readonly finished: Promise<void>;
  readonly skipTransition?: () => void;
};

// Longer than the 300ms step animation. Headless Chromium can leave
// `finished` pending, and the view-transition pseudo-element then sits over
// the page and swallows every click. Skipping past this bound releases it.
const STUCK_TRANSITION_MS = 1_000;

type OnboardingTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => OnboardingViewTransition;
};

/**
 * Creates one interruptible transition owner for a staged onboarding page.
 * Unsupported and reduced-motion environments cut directly to the next step.
 * A transition that never settles is skipped, so its overlay cannot keep
 * blocking the next control.
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
      !prefersReducedMotion(ownerDocument) &&
      typeof ownerDocument.startViewTransition === "function";
    if (!canTransition) {
      reveal(next, direction);
      next.classList.add("is-entering");
      focus(next);
      return;
    }

    activeTransition?.skipTransition?.();
    const generation = ++transitionGeneration;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      if (generation !== transitionGeneration) {
        return;
      }
      transitionGeneration += 1;
      activeTransition = null;
      if (settleTimer !== undefined) {
        clearTimeout(settleTimer);
        settleTimer = undefined;
      }
      delete root.dataset["onboardingDirection"];
      focus(next);
    };
    root.dataset["onboardingDirection"] = direction;
    // Arm the watchdog before the transition starts. A stuck snapshot can
    // defer timers scheduled while it is active, which would leave the
    // watchdog waiting on the very transition it is supposed to end.
    settleTimer = setTimeout(() => {
      if (generation !== transitionGeneration) {
        return;
      }
      activeTransition?.skipTransition?.();
      finish();
    }, STUCK_TRANSITION_MS);
    const transition = ownerDocument.startViewTransition?.(() => reveal(next, direction));
    if (!transition) {
      finish();
      reveal(next, direction);
      return;
    }
    activeTransition = transition;
    void transition.finished.then(finish, finish);
  };
};
