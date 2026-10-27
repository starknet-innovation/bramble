/**
 * The background's one handle on the request surface: the user's choice, the
 * side-panel learning (#690), and the surface in effect derived from both.
 * Split from `../index` so the entrypoint stays a wiring list.
 *
 * The user's choice is written only by the user (Settings, a restored backup).
 * The learner writes only its own record. The surface in effect is:
 * - the popup when the user chose the popup;
 * - the side panel when the user chose it, unless this browser was learned
 *   not to draw side panels (Arc), where the popup serves it instead.
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
  /** The surface in effect: the user's choice, after what was learned. */
  readonly effective: () => ApprovalSurfacePreference;
  readonly learner: SidePanelLearner;
  /** Loads what was learned. Call once the stored choice has been applied. */
  readonly load: () => Promise<void>;
  /** The user's own choice, as last saved. */
  readonly preference: () => ApprovalSurfacePreference;
  /**
   * Applies a choice the user just saved. Choosing the side panel again on a
   * browser learned not to draw it asks the learner to try once more.
   */
  readonly update: (preference: ApprovalSurfacePreference) => void;
};

/** Creates the control. It never writes the user's choice. */
export const createApprovalSurfaceControl = ({
  browser,
  extensionId,
  store,
  wait,
}: {
  readonly browser: ApprovalSurfaceControlBrowser | undefined;
  readonly extensionId: string;
  readonly store: () => KeyValueStore | null;
  readonly wait: (ms: number) => Promise<void>;
}): ApprovalSurfaceControl => {
  let preference: ApprovalSurfacePreference = "side-panel";
  let learner: SidePanelLearner | null = null;
  const effective = (): ApprovalSurfacePreference =>
    preference === "popup" || learner?.state() === "unsupported" ? "popup" : "side-panel";
  const configure = (): Promise<void> =>
    configureApprovalSurface(browser, effective(), learner?.nativeClick() ?? true);
  const reconfigure = (): void => void configure().catch(() => undefined);
  const control = (resolved: SidePanelLearner): ApprovalSurfaceControl => ({
    apply(next) {
      preference = next;
      reconfigure();
    },
    bind() {
      bindToolbarActivation(browser, effective);
      resolved.bind();
    },
    effective,
    learner: resolved,
    load: () => resolved.load(),
    preference: () => preference,
    update(next) {
      preference = next;
      if (next === "side-panel") resolved.retrySidePanel();
      reconfigure();
    },
  });
  learner = createSidePanelLearner({
    browser,
    configure,
    extensionId,
    sidePanelUrl: browser?.runtime?.getURL?.("sidepanel.html") ?? "",
    store,
    surface: effective,
    wait,
  });
  return control(learner);
};
