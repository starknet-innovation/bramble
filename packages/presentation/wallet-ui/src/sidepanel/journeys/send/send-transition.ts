/**
 * Interruptible, reduced-motion-aware choreography for the changing body of
 * the Send flow. The progress rail stays live while the browser snapshots only
 * the named stage frame, preserving continuity between review and signing.
 */
import { transitionTaskStage } from "../../app/rendering/stage-transition";

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
  submitted: 3,
} as const;

type VisibleSendStage = keyof typeof STAGE_ORDER;
type SendStage = VisibleSendStage | "reviewing";
const isSendStage = (stage: string | undefined): stage is SendStage =>
  stage === "reviewing" || (stage !== undefined && Object.hasOwn(STAGE_ORDER, stage));
const visibleStage = (stage: SendStage): VisibleSendStage =>
  stage === "reviewing" ? "details" : stage;
const isProgressStage = (stage: VisibleSendStage): boolean =>
  stage === "authorizing" || stage === "broadcasting" || stage === "confirming";

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
  if (!isSendStage(previousStage)) {
    update();
    return;
  }
  const previousVisible = visibleStage(previousStage);
  const nextVisible = visibleStage(nextStage);
  if (
    previousVisible === nextVisible ||
    (isProgressStage(previousVisible) && isProgressStage(nextVisible))
  ) {
    update();
    return;
  }
  transitionTaskStage(
    doc,
    previousVisible,
    nextVisible,
    STAGE_ORDER,
    "sendTransition",
    "sendTransitionId",
    update,
  );
};
