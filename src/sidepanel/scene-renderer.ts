/**
 * Side-panel shell replacement and View Transitions choreography.
 */

import { captureRepaintFocus, restoreRepaintFocus } from "./focus-memo";
import { animateLiveValueChanges, captureLiveValues } from "./live-updates";
import { prefersReducedMotion } from "./motion";
import type { NavDirection } from "./nav-direction";
import { SIDEPANEL_STYLES } from "./styles";

type ViewTransition = { readonly finished: Promise<void> };
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ViewTransition;
};

/**
 * Creates the scene renderer around one mount and its post-render binder.
 */
export const createSceneRenderer = (
  app: Element | null,
  bind: () => void,
): ((content: string, animate: boolean, direction: NavDirection) => void) => {
  const mount = app;
  const renderShell = (content: string, animate: boolean): void => {
    if (!mount) {
      return;
    }
    const focus = captureRepaintFocus();
    const liveValues = captureLiveValues(mount);
    mount.innerHTML = `<style>${SIDEPANEL_STYLES}</style><section class="shell${animate ? " shell-animate" : ""}">${content}</section>`;
    restoreRepaintFocus(mount, focus);
    animateLiveValueChanges(mount, liveValues);
  };

  return (content, animate, direction) => {
    const doc = document as ViewTransitionDocument;
    if (!animate || prefersReducedMotion() || typeof doc.startViewTransition !== "function") {
      renderShell(content, animate);
      bind();
      return;
    }
    document.documentElement.dataset["navDirection"] = direction;
    const transition = doc.startViewTransition(() => {
      renderShell(content, false);
      bind();
    });
    void transition.finished.finally(() => {
      delete document.documentElement.dataset["navDirection"];
    });
  };
};
