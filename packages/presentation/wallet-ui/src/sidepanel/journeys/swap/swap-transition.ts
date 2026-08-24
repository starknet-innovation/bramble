/**
 * Directional stage choreography for edit, review, and submitted swap states.
 */
import { transitionTaskStage } from "../../app/rendering/stage-transition";

/**
 * A visible step in the swap task flow.
 */
export type SwapStage = "confirm" | "edit" | "success";

const SWAP_STAGE_ORDER: Readonly<Record<SwapStage, number>> = {
  confirm: 1,
  edit: 0,
  success: 2,
};

/**
 * Applies one swap stage change without animating reduced-motion contexts.
 */
export const transitionSwapStage = (
  doc: Document,
  previousStage: SwapStage,
  nextStage: SwapStage,
  update: () => void,
): void =>
  transitionTaskStage(
    doc,
    previousStage,
    nextStage,
    SWAP_STAGE_ORDER,
    "swapTransition",
    "swapTransitionId",
    update,
  );
