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
  reviewing: 1,
  submitted: 3,
} as const;

type SendStage = keyof typeof STAGE_ORDER;
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
  if (!isSendStage(previousStage)) {
    update();
    return;
  }
  transitionTaskStage(
    doc,
    previousStage,
    nextStage,
    STAGE_ORDER,
    "sendTransition",
    "sendTransitionId",
    update,
  );
};
