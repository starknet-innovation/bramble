/**
 * Interruptible metadata wrapper for full side-panel View Transitions. An old
 * transition may finish after a newer navigation starts, so cleanup is scoped
 * by a serial instead of blindly deleting the newer direction.
 */
import { prefersReducedMotion } from "./motion";
import type { NavDirection } from "./nav-direction";

type ViewTransition = { readonly finished: Promise<void> };
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ViewTransition;
};

let transitionSerial = 0;

/**
 * Commits a scene change with native View Transitions when available. The
 * callback receives whether it should use the CSS fallback entrance instead.
 */
export const transitionScene = (
  doc: Document,
  direction: NavDirection,
  commit: (animateFallback: boolean) => void,
): void => {
  if (prefersReducedMotion()) {
    commit(false);
    return;
  }
  const transitionDocument = doc as ViewTransitionDocument;
  if (typeof transitionDocument.startViewTransition !== "function") {
    commit(true);
    return;
  }

  const id = String(++transitionSerial);
  const root = doc.documentElement;
  root.dataset["navDirection"] = direction;
  root.dataset["navTransitionId"] = id;
  let committed = false;
  const cleanup = (): void => {
    if (root.dataset["navTransitionId"] === id) {
      delete root.dataset["navDirection"];
      delete root.dataset["navTransitionId"];
    }
  };
  try {
    const transition = transitionDocument.startViewTransition(() => {
      committed = true;
      commit(false);
    });
    void transition.finished.then(cleanup, cleanup);
  } catch {
    cleanup();
    if (!committed) commit(true);
  }
};
