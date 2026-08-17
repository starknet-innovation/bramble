/**
 * Side-panel shell replacement and View Transitions choreography.
 */

import { SIDEPANEL_STYLES } from "../../styles/index";
import type { NavDirection } from "../navigation/nav-direction";
import { animateLiveValueChanges, captureLiveValues } from "../sync/live-updates";
import { captureRepaintFocus, restoreRepaintFocus } from "./focus-memo";
import { transitionScene } from "./scene-transition";

/**
 * Mounts the persistent live region used for account and network scope changes.
 */
export const createScopeAnnouncer = (doc: Document): HTMLElement => {
  const announcer = doc.createElement("p");
  announcer.className = "sr-only";
  announcer.setAttribute("aria-atomic", "true");
  announcer.setAttribute("aria-live", "polite");
  doc.body.append(announcer);
  return announcer;
};

/**
 * Message describing which account-scoped data is refreshing after a scope change.
 */
export const scopeChangeAnnouncement = (change: "account" | "network"): string =>
  `${change === "network" ? "Network" : "Account"} changed. Updating account balances, activity, and permissions.`;

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
