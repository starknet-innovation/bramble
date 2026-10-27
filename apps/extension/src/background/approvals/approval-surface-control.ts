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
  /** Applies the stored choice at worker start. Browser failures are swallowed. */
  readonly apply: (preference: ApprovalSurfacePreference) => void;
  /** Binds the toolbar listeners. Call once, at the top level of the worker. */
  readonly bind: () => void;
  readonly learner: SidePanelLearner;
  /** Loads what was learned. Call once the stored choice has been applied. */
  readonly load: () => Promise<void>;
  readonly preference: () => ApprovalSurfacePreference;
  /**
   * Applies a choice the user just saved (Settings, a restored backup) and
   * tells the learner, so an automatic switch is never undone after it.
   * Only the preferences store's user-facing writes reach this.
   */
  readonly update: (preference: ApprovalSurfacePreference) => void;
};

/**
 * Creates the control. `saveSurface` writes a request surface straight to the
 * preferences store without reporting it back through `update`: the learner
 * uses it only for its own automatic changes, which are never the user's.
 */
export const createApprovalSurfaceControl = ({
  browser,
  extensionId,
  saveSurface,
  store,
  wait,
}: {
  readonly browser: ApprovalSurfaceControlBrowser | undefined;
  readonly extensionId: string;
  readonly saveSurface: (preference: ApprovalSurfacePreference) => Promise<unknown>;
  readonly store: () => KeyValueStore | null;
  readonly wait: (ms: number) => Promise<void>;
}): ApprovalSurfaceControl => {
  let preference: ApprovalSurfacePreference = "side-panel";
  let learner: SidePanelLearner | null = null;
  const configure = (): Promise<void> =>
    configureApprovalSurface(browser, preference, learner?.nativeClick() ?? true);
  const reconfigure = (): void => void configure().catch(() => undefined);
  const control = (resolved: SidePanelLearner): ApprovalSurfaceControl => ({
    apply(next) {
      preference = next;
      reconfigure();
    },
    bind() {
      bindToolbarActivation(browser, () => preference);
      resolved.bind();
    },
    learner: resolved,
    load: () => resolved.load(),
    preference: () => preference,
    update(next) {
      preference = next;
      resolved.userChose(next);
      reconfigure();
    },
  });
  learner = createSidePanelLearner({
    applySurface(next) {
      preference = next;
      return configure();
    },
    browser,
    extensionId,
    preference: () => preference,
    reconfigure,
    async saveSurface(next) {
      await saveSurface(next);
    },
    sidePanelUrl: browser?.runtime?.getURL?.("sidepanel.html") ?? "",
    store,
    wait,
  });
  return control(learner);
};
