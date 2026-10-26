/**
 * The background's one handle on the request surface: the user's choice, the
 * toolbar wiring, and the side-panel learning that switches a browser that
 * never draws side panels (Arc, #690) to the compact popup. Split from
 * `../index` so the entrypoint stays a wiring list.
 */

import type { ApprovalSurfacePreference } from "@bramble/settings/preferences";
import type { KeyValueStore } from "@bramble/store/kv";
import {
  type ApprovalSurfaceBrowser,
  bindToolbarActivation,
  configureApprovalSurface,
} from "./approval-surface";
import {
  createSidePanelLearner,
  type SidePanelLearner,
  type SidePanelLearningBrowser,
} from "./side-panel-learning";

/** The browser slices the control reads. */
export type ApprovalSurfaceControlBrowser = ApprovalSurfaceBrowser &
  SidePanelLearningBrowser & {
    readonly runtime?: SidePanelLearningBrowser["runtime"] & {
      readonly getURL?: (path: string) => string;
    };
  };

/** The request-surface state the entrypoint and router share. */
export type ApprovalSurfaceControl = {
  /** Binds the toolbar listeners. Call once, at the top level of the worker. */
  readonly bind: () => void;
  readonly learner: SidePanelLearner;
  /** Loads what was learned. Call once trusted storage is ready. */
  readonly load: () => Promise<void>;
  readonly preference: () => ApprovalSurfacePreference;
  /** Applies a new user choice. Browser failures are swallowed. */
  readonly update: (preference: ApprovalSurfacePreference) => void;
};

/**
 * Creates the control. `savePopup` stores "popup" as the user's choice through
 * the preferences store; it is only called when a toolbar click proved the
 * side panel never appears.
 */
export const createApprovalSurfaceControl = ({
  browser,
  extensionId,
  savePopup,
  store,
  wait,
}: {
  readonly browser: ApprovalSurfaceControlBrowser | undefined;
  readonly extensionId: string;
  readonly savePopup: () => Promise<unknown>;
  readonly store: () => KeyValueStore | null;
  readonly wait: (ms: number) => Promise<void>;
}): ApprovalSurfaceControl => {
  let preference: ApprovalSurfacePreference = "side-panel";
  let learner: SidePanelLearner | null = null;
  const configure = (): Promise<void> =>
    configureApprovalSurface(browser, preference, learner?.nativeClick() ?? true);
  const reconfigure = (): void => void configure().catch(() => undefined);
  const control = (resolved: SidePanelLearner): ApprovalSurfaceControl => ({
    bind() {
      bindToolbarActivation(browser, () => preference);
      resolved.bind();
    },
    learner: resolved,
    load: () => resolved.load(),
    preference: () => preference,
    update(next) {
      preference = next;
      reconfigure();
    },
  });
  learner = createSidePanelLearner({
    browser,
    extensionId,
    preference: () => preference,
    reconfigure,
    sidePanelUrl: browser?.runtime?.getURL?.("sidepanel.html") ?? "",
    store,
    async switchToPopup() {
      await savePopup();
      preference = "popup";
      await configure();
    },
    wait,
  });
  return control(learner);
};
