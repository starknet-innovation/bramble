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
  /** Applies the stored choice at worker start. Browser failures are swallowed. */
  readonly apply: (preference: ApprovalSurfacePreference) => void;
  /**
   * Applies a choice the user just saved (Settings, a restored backup). It
   * also tells the learner, so an automatic switch is never undone after it.
   */
  readonly update: (preference: ApprovalSurfacePreference) => void;
};

/**
 * Creates the control. `saveSurface` stores a request surface through the
 * preferences store. The learner calls it only to switch to the popup after a
 * click proved the side panel never appears, and to switch back if a real
 * panel then renders; those saves are not the user's choice.
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
  // True while the learner's own save is in flight: the preferences store
  // reports it back through `update`, and it must not read as the user's choice.
  let saving = false;
  const save = async (next: ApprovalSurfacePreference): Promise<void> => {
    saving = true;
    try {
      await saveSurface(next);
    } finally {
      saving = false;
    }
    preference = next;
    await configure();
  };
  const control = (resolved: SidePanelLearner): ApprovalSurfaceControl => ({
    bind() {
      bindToolbarActivation(browser, () => preference);
      resolved.bind();
    },
    apply(next) {
      preference = next;
      reconfigure();
    },
    learner: resolved,
    load: () => resolved.load(),
    preference: () => preference,
    update(next) {
      preference = next;
      if (!saving) resolved.userChose();
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
    restoreSidePanel: () => save("side-panel"),
    switchToPopup: () => save("popup"),
    wait,
  });
  return control(learner);
};
