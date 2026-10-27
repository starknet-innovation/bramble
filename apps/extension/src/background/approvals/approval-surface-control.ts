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
  /** Binds the toolbar listeners. Call once, at the top level of the worker. */
  readonly bind: () => void;
  /** The surface in effect: the user's choice, after what was learned. */
  readonly effective: () => ApprovalSurfacePreference;
  readonly learner: SidePanelLearner;
  /** The user's own choice, as last saved. */
  readonly preference: () => ApprovalSurfacePreference;
  /**
   * Starts the surface once the stored choice is read: takes the choice (the
   * side panel when the read fails), then loads what was learned and
   * configures the toolbar. Runs once; later calls return the first run.
   * Until then the toolbar is left as the browser kept it, so a click on a
   * worker that just woke is never served by a half-loaded state.
   */
  readonly start: (stored: Promise<ApprovalSurfacePreference | undefined>) => Promise<void>;
  /**
   * Applies a choice the user just saved. Choosing the side panel again on a
   * browser learned not to draw it asks the learner to try once more.
   */
  readonly update: (preference: ApprovalSurfacePreference) => void;
};

const succeeds = (work: Promise<unknown>): Promise<boolean> =>
  work.then(
    () => true,
    () => false,
  );

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
  // A choice saved before the stored one was read is newer: keep it.
  let chosen = false;
  let started: Promise<void> | null = null;
  let learner: SidePanelLearner | null = null;
  const effective = (): ApprovalSurfacePreference =>
    preference === "popup" || learner?.state() === "unsupported" ? "popup" : "side-panel";
  const applyNow = (): Promise<void> =>
    configureApprovalSurface(browser, effective(), learner?.nativeClick() ?? true);
  // One configuration at a time, each reading the state when it runs, so the
  // last one always applies the latest surface whatever order the browser
  // answers in. A refusal is retried once: a stale popup would otherwise hide
  // the toolbar click that could repair it. Refused twice, a stale popup can
  // stay until the next worker start, and `start` configures again then (the
  // popup page messages the background, which wakes the worker).
  let configuring: Promise<void> = Promise.resolve();
  const configure = (): Promise<void> => {
    const run = async (): Promise<void> => {
      if (!(await succeeds(applyNow()))) await applyNow();
    };
    configuring = configuring.then(run, run);
    return configuring;
  };
  const reconfigure = (): void => {
    if (learner?.loaded()) void configure().catch(() => undefined);
  };
  learner = createSidePanelLearner({
    browser,
    configure,
    extensionId,
    sidePanelUrl: browser?.runtime?.getURL?.("sidepanel.html") ?? "",
    store,
    surface: effective,
    wait,
  });
  const resolved = learner;
  return {
    bind() {
      bindToolbarActivation(browser, effective);
      resolved.bind();
    },
    effective,
    learner: resolved,
    preference: () => preference,
    start(stored) {
      started ??= stored
        .catch(() => undefined)
        .then((read) => {
          if (!chosen) preference = read ?? "side-panel";
          return resolved.load();
        });
      return started;
    },
    update(next) {
      preference = next;
      chosen = true;
      if (next === "side-panel") resolved.retrySidePanel();
      reconfigure();
    },
  };
};
