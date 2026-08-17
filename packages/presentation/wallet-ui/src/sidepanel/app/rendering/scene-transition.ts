/**
 * Interruptible metadata wrapper for full side-panel View Transitions. An old
 * transition may finish after a newer navigation starts, so cleanup is scoped
 * by a serial instead of blindly deleting the newer direction.
 */

import type { WalletStatus } from "../../../popup/responses/responses";
import { prefersReducedMotion } from "../../shared/motion";
import { type NavDirection, navDirection } from "../navigation/nav-direction";
import type { WalletView } from "../screens/views";

type ViewTransition = { readonly finished: Promise<void> };
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ViewTransition;
};

let transitionSerial = 0;

/**
 * Stable scene identity used to animate real task changes, including approvals.
 */
export const sceneFor = (
  fullPageOnboarding: boolean,
  status: Pick<WalletStatus, "hasVault" | "locked">,
  approvalId: string | undefined,
  activeView: WalletView,
): string => {
  if (fullPageOnboarding && status.hasVault) return "onboarding-complete";
  if (!status.hasVault) return "onboarding";
  if (status.locked) return "locked";
  return approvalId ? `approval:${approvalId}` : `dashboard:${activeView}`;
};

/**
 * Resolves motion direction when an external request interrupts or releases a wallet task.
 */
export const sceneDirection = (
  forced: NavDirection | null,
  scene: string,
  previousScene: string,
  previousView: WalletView,
  activeView: WalletView,
): NavDirection => {
  if (forced) return forced;
  if (scene.startsWith("approval:")) return "forward";
  if (previousScene.startsWith("approval:")) return "back";
  return navDirection(previousView, activeView);
};

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
