/**
 * Shared directional View Transition primitive for short task flows. The
 * caller owns the semantic stage order and the CSS named view.
 */
import { prefersReducedMotion } from "../../shared/motion";

type ViewTransition = { readonly finished: Promise<void> };
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ViewTransition;
};

let transitionSerial = 0;

/**
 * Applies a stage update within a directional View Transition when supported.
 * Unsupported and reduced-motion environments update synchronously.
 */
export const transitionTaskStage = <Stage extends string>(
  doc: Document,
  previousStage: Stage,
  nextStage: Stage,
  order: Readonly<Record<Stage, number>>,
  transitionKey: string,
  transitionIdKey: string,
  update: () => void,
): void => {
  if (previousStage === nextStage || prefersReducedMotion(doc)) {
    update();
    return;
  }
  const transitionDocument = doc as ViewTransitionDocument;
  if (typeof transitionDocument.startViewTransition !== "function") {
    update();
    return;
  }

  const id = String(++transitionSerial);
  const root = doc.documentElement;
  root.dataset[transitionKey] = order[nextStage] >= order[previousStage] ? "forward" : "back";
  root.dataset[transitionIdKey] = id;
  let updated = false;
  const cleanup = (): void => {
    if (root.dataset[transitionIdKey] === id) {
      delete root.dataset[transitionKey];
      delete root.dataset[transitionIdKey];
    }
  };

  try {
    const transition = transitionDocument.startViewTransition(() => {
      updated = true;
      update();
    });
    void transition.finished.then(cleanup, cleanup);
  } catch {
    cleanup();
    if (!updated) update();
  }
};
