/**
 * Interruptible, reduced-motion-aware choreography for the changing body of
 * the Send flow. The progress rail stays live while the browser snapshots only
 * the named stage frame, preserving continuity between review and signing.
 */
import { prefersReducedMotion } from "../../shared/motion";

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
const PROPOSAL_STAGE_ORDER = {
  advanced: 2,
  amount: 1,
  asset: 2,
  recipient: 0,
  review: 3,
} as const;
type ProposalStage = keyof typeof PROPOSAL_STAGE_ORDER;
type ViewTransition = { readonly finished: Promise<void> };
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ViewTransition;
};

let transitionSerial = 0;

const isSendStage = (stage: string | undefined): stage is SendStage =>
  stage !== undefined && Object.hasOwn(STAGE_ORDER, stage);

const transitionStage = <Stage extends string>(
  doc: Document,
  previousStage: string | undefined,
  nextStage: Stage,
  order: Readonly<Record<Stage, number>>,
  transitionKey: "proposalTransition" | "sendTransition",
  transitionIdKey: "proposalTransitionId" | "sendTransitionId",
  update: () => void,
): void => {
  if (
    previousStage === undefined ||
    !Object.hasOwn(order, previousStage) ||
    previousStage === nextStage ||
    prefersReducedMotion()
  ) {
    update();
    return;
  }
  const transitionDocument = doc as ViewTransitionDocument;
  if (typeof transitionDocument.startViewTransition !== "function") {
    update();
    return;
  }

  const serial = ++transitionSerial;
  const id = String(serial);
  const root = doc.documentElement;
  root.dataset[transitionKey] =
    order[nextStage] >= order[previousStage as Stage] ? "forward" : "back";
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
  transitionStage(
    doc,
    previousStage,
    nextStage,
    STAGE_ORDER,
    "sendTransition",
    "sendTransitionId",
    update,
  );
};

/**
 * Applies one multisig proposal-stage update with the same directional motion
 * language as Send while keeping its transition metadata independently scoped.
 */
export const transitionProposalStage = (
  doc: Document,
  previousStage: string | undefined,
  nextStage: ProposalStage,
  update: () => void,
): void =>
  transitionStage(
    doc,
    previousStage,
    nextStage,
    PROPOSAL_STAGE_ORDER,
    "proposalTransition",
    "proposalTransitionId",
    update,
  );
