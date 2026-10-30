/**
 * Shared directional View Transition primitive for short task flows. The
 * caller owns the semantic stage order and the CSS named view.
 */
import { prefersReducedMotion } from "../../shared/motion";

/**
 * The parts of a native View Transition the wallet reads. `ready` and
 * `updateCallbackDone` are optional so test doubles and older engines that
 * only expose `finished` still type-check.
 */
export type ViewTransition = {
  readonly finished: Promise<void>;
  readonly ready?: Promise<void>;
  readonly updateCallbackDone?: Promise<void>;
};
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ViewTransition;
};

/**
 * Runs `cleanup` once the transition settles either way, and observes every
 * promise the transition exposes. Chrome rejects `ready` (and can reject
 * `updateCallbackDone`) when it skips or times out the animation; the DOM
 * update still commits, so those rejections carry nothing to act on and are
 * swallowed rather than surfacing as unhandled rejections.
 */
export const settleViewTransition = (transition: ViewTransition, cleanup: () => void): void => {
  const ignore = (): void => undefined;
  void transition.ready?.catch(ignore);
  void transition.updateCallbackDone?.catch(ignore);
  void transition.finished.then(cleanup, cleanup);
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
    settleViewTransition(transition, cleanup);
  } catch {
    cleanup();
    if (!updated) update();
  }
};
