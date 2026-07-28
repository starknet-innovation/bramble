/**
 * Interruptible, reduced-motion-aware choreography for the changing body of
 * the Send flow. The progress rail stays live while the browser snapshots only
 * the named stage frame, preserving continuity between review and signing.
 */
import { prefersReducedMotion } from "./motion";

const STAGE_ORDER = {
  asset: 1,
  authorizing: 2,
  broadcasting: 2,
  confirming: 3,
  details: 0,
  failed: 3,
  pending: 3,
  recipient: -1,
  review: 1,
  reviewing: 1,
  submitted: 3,
} as const;

type SendStage = keyof typeof STAGE_ORDER;
type ViewTransition = { readonly finished: Promise<void> };
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ViewTransition;
};

let transitionSerial = 0;

const isSendStage = (stage: string | undefined): stage is SendStage =>
  stage !== undefined && Object.hasOwn(STAGE_ORDER, stage);

/**
 * Applies one Send-stage update inside a directional named View Transition
 * when supported. Calls the update synchronously as a no-motion fallback and
 * never leaves direction metadata behind after failure or interruption.
 */
export const transitionSendStage = (
  doc: Document,
  previousStage: string | undefined,
  nextStage: SendStage,
  update: () => void,
): void => {
  const transitionDocument = doc as ViewTransitionDocument;
  if (
    !isSendStage(previousStage) ||
    previousStage === nextStage ||
    prefersReducedMotion() ||
    typeof transitionDocument.startViewTransition !== "function"
  ) {
    update();
    return;
  }

  const serial = ++transitionSerial;
  const id = String(serial);
  const root = doc.documentElement;
  root.dataset["sendTransition"] =
    STAGE_ORDER[nextStage] >= STAGE_ORDER[previousStage] ? "forward" : "back";
  root.dataset["sendTransitionId"] = id;
  let updated = false;
  const cleanup = (): void => {
    if (root.dataset["sendTransitionId"] === id) {
      delete root.dataset["sendTransition"];
      delete root.dataset["sendTransitionId"];
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
    if (!updated) {
      update();
    }
  }
};
