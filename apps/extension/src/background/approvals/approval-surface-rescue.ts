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
 * It acts only for a request the wallet accepted: an approval from that
 * origin that was not pending when the request arrived must appear, and must
 * still be pending at the moment the popup would open. A request that is
 * refused, needs no approval, or is decided elsewhere first opens nothing.
 * A connection request is the one exception: the queue keeps one connect
 * approval per origin, so a repeated Connect joins the one already pending,
 * and that approval counts as its own (#973).
 *
 * It opens no window, moves no focus, writes nothing, and never reaches the
 * side-panel learner: a refused open says nothing about whether this browser
 * draws side panels. Because it needs no gesture, at most one runs at a time,
 * and one opens the popup at most every {@link SURFACE_RESCUE_THROTTLE_MS}
 * across all tabs, checked when it would open, on top of the opener's per-tab
 * cooldown, so pages can't use it to keep the popup open.
 */

import { isRecord } from "@bramble/core/json";

/** Shortest gap between two rescued popups, across every tab. */
export const SURFACE_RESCUE_THROTTLE_MS = 5_000;

/**
 * How long a rescue waits for its request's approval to be queued. Requests
 * that do expensive work first (a fee estimate) queue later; one that hasn't
 * by then is dropped.
 */
export const SURFACE_RESCUE_ACCEPT_MS = 10_000;
const POLL_MS = 250;

/** The browser slices the rescue reads. Every member is optional. */
export type SurfaceRescueBrowser = {
  readonly runtime?: {
    readonly getContexts?: (filter: {
      readonly contextTypes: readonly string[];
    }) => Promise<readonly unknown[]>;
  };
  readonly sidePanel?: unknown;
};

/** A pending approval's identity, as the queue lists it. */
export type RescueApproval = {
  readonly id: string;
  readonly kind?: string;
  readonly origin: string;
};

/** Runs a prepared rescue once its side panel open was refused. Never rejects. */
export type RescueAttempt = () => Promise<void>;

/**
 * Prepares a rescue for one request, synchronously when it arrives, so the
 * approvals already pending for its origin are known before it can queue one.
 */
export type SurfaceRescue = (request: {
  /** A connection request, which joins its origin's pending connect approval. */
  readonly connect?: boolean;
  readonly origin: string;
  readonly windowId: number | undefined;
}) => RescueAttempt;

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

const nothing: RescueAttempt = async () => undefined;

/**
 * Creates the rescue. Inert without Chromium's side panel API (Firefox), or
 * for a request without a window id.
 */
export const createSurfaceRescue = ({
  approvals,
  browser,
  now,
  showPopup,
  wait,
}: {
  /** The approvals pending now. */
  readonly approvals: () => readonly RescueApproval[];
  readonly browser: SurfaceRescueBrowser | undefined;
  readonly now: () => number;
  /**
   * Opens the toolbar popup in a window, inside the toolbar's configuration
   * queue, if `admit` still says yes when its turn comes; rejects when refused.
   */
  readonly showPopup: (windowId: number, admit: () => boolean) => Promise<void>;
  readonly wait: (ms: number) => Promise<void>;
}): SurfaceRescue => {
  let lastAt: number | null = null;
  let running = false;
  const pendingFrom = (origin: string): readonly RescueApproval[] =>
    approvals().filter((approval) => approval.origin === origin);
  const idsFrom = (origin: string): readonly string[] =>
    pendingFrom(origin).map((approval) => approval.id);
  // The approval this request queued, waited for up to the accept window's length.
  const accepted = async (origin: string, known: ReadonlySet<string>): Promise<string | null> => {
    for (let waited = 0; ; waited += POLL_MS) {
      const id = idsFrom(origin).find((candidate) => !known.has(candidate));
      if (id !== undefined) return id;
      if (waited >= SURFACE_RESCUE_ACCEPT_MS) return null;
      await wait(POLL_MS);
    }
  };
  // Checked in the popup queue, right before opening: still pending, and the
  // interval since the last rescued popup has passed. Taking the slot here,
  // not at admission, keeps two delayed rescues from opening back to back.
  const admit = (origin: string, id: string) => (): boolean => {
    if (!idsFrom(origin).includes(id)) return false;
    const at = now();
    if (lastAt !== null && at >= lastAt && at - lastAt < SURFACE_RESCUE_THROTTLE_MS) return false;
    lastAt = at;
    return true;
  };
  return ({ connect = false, origin, windowId }) => {
    if (!browser?.sidePanel || typeof windowId !== "number") return nothing;
    const known = new Set(
      pendingFrom(origin)
        .filter((approval) => !(connect && approval.kind === "connect"))
        .map((approval) => approval.id),
    );
    return async () => {
      // At most one outstanding rescue; a later one is dropped.
      if (running) return;
      running = true;
      try {
        const id = await accepted(origin, known);
        if (id === null || (await panelOpenIn(browser, windowId))) return;
        await showPopup(windowId, admit(origin, id)).catch(() => undefined);
      } finally {
        running = false;
      }
    };
  };
};
