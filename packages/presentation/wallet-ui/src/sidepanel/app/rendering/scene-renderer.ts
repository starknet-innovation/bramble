/**
 * Side-panel shell replacement and View Transitions choreography.
 */

import { SIDEPANEL_STYLES } from "../../styles/index";
import type { NavDirection } from "../navigation/nav-direction";
import { animateLiveValueChanges, captureLiveValues } from "../sync/live-updates";
import { captureRepaintFocus, restoreRepaintFocus } from "./focus-memo";
import { transitionScene } from "./scene-transition";

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
    const doc = mount?.ownerDocument;
    if (!animate || doc === undefined) {
      renderShell(content, animate);
      bind();
      return;
    }
    transitionScene(doc, direction, (animateFallback) => {
      renderShell(content, animateFallback);
      bind();
    });
  };
};
