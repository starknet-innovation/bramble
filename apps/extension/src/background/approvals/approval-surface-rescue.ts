/**
 * Rescues a dapp-triggered side panel open that Chromium refused (#707).
 *
 * `sidePanel.open` needs the page's user gesture, and a dapp's request often
 * reaches the worker after that gesture expired, so Chrome refuses and nothing
 * opens. The rescue, Chromium only: when a side panel is already open in that
 * window, nothing more is needed; otherwise the toolbar popup is opened, which
 * Chrome 127+ allows without a gesture (through the surface control, which
 * sets the popup for that moment: Chrome opens only a popup that is set);
 * when that is refused too, the badge the queue already shows is what remains.
 *
 * It opens no window, moves no focus, writes nothing, and never reaches the
 * side-panel learner: a refused open says nothing about whether this browser
 * draws side panels. Because it needs no gesture, it is throttled across all
 * tabs on top of the opener's per-tab cooldown, so pages can't use it to keep
 * the popup open.
 */

import { isRecord } from "@bramble/core/json";

/** Shortest gap between two rescues, across every tab. */
export const SURFACE_RESCUE_THROTTLE_MS = 5_000;

/** The browser slices the rescue reads. Every member is optional. */
export type SurfaceRescueBrowser = {
  readonly runtime?: {
    readonly getContexts?: (filter: {
      readonly contextTypes: readonly string[];
    }) => Promise<readonly unknown[]>;
  };
  readonly sidePanel?: unknown;
};

/** Rescues one refused open in the window it names. Never rejects. */
export type SurfaceRescue = (windowId: number | undefined) => Promise<void>;

// True when a side panel is open in this window; null when the browser could
// not say, which is not read as "open".
const panelOpenIn = async (
  browser: SurfaceRescueBrowser,
  windowId: number,
): Promise<boolean | null> => {
  const getContexts = browser.runtime?.getContexts;
  if (!getContexts) return null;
  try {
    const contexts = await getContexts({ contextTypes: ["SIDE_PANEL"] });
    return contexts.some((context) => isRecord(context) && context["windowId"] === windowId);
  } catch {
    return null;
  }
};

/**
 * Creates the rescue. Inert without Chromium's side panel API (Firefox), or
 * for a request without a window id.
 */
export const createSurfaceRescue = ({
  browser,
  now,
  showPopup,
}: {
  readonly browser: SurfaceRescueBrowser | undefined;
  readonly now: () => number;
  /** Opens the toolbar popup in a window; rejects when refused. */
  readonly showPopup: (windowId: number) => Promise<void>;
}): SurfaceRescue => {
  let lastAt: number | null = null;
  const throttled = (at: number): boolean => {
    if (lastAt !== null && at >= lastAt && at - lastAt < SURFACE_RESCUE_THROTTLE_MS) {
      return true;
    }
    lastAt = at;
    return false;
  };
  return async (windowId) => {
    if (!browser?.sidePanel || typeof windowId !== "number") return;
    if (throttled(now())) return;
    if (await panelOpenIn(browser, windowId)) return;
    await showPopup(windowId).catch(() => undefined);
  };
};
