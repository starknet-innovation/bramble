/**
 * Opens the wallet in its own window when the side panel cannot be shown.
 *
 * Two Chromium cases leave a dapp request with no visible wallet:
 * - `sidePanel.open()` rejects because the page's user gesture had expired by
 *   the time the request arrived. Connect modals often await discovery or a
 *   network call before asking the wallet (#707).
 * - `sidePanel.open()` resolves but nothing is drawn, as on Arc (#690).
 *
 * The first is known at once. The second is detected by asking the wallet
 * pages whether one of them is visible (`@bramble/wallet-protocol/surface-presence`). Either way the
 * request itself is untouched: it stays queued, and the window only shows the
 * same queue the side panel would have shown. A window needs no user gesture
 * and no manifest permission. One window is reused, so repeated requests
 * focus it instead of stacking new ones.
 */

import {
  readSurfacePresenceMessage,
  SURFACE_PRESENCE_CHANNEL,
  type SurfacePresenceChannel,
} from "@bramble/wallet-protocol/surface-presence";

/**
 * How long a freshly opened panel has to report itself visible. A cold side
 * panel boots well within this on Chrome; a panel Arc never draws stays silent
 * however long we wait.
 */
const PRESENCE_TIMEOUT_MS = 3_000;

/** Window size close to a side panel, so the wallet layout reads the same. */
const WINDOW_SIZE = { height: 680, width: 400 } as const;

/** Narrow `chrome.windows` surface; neither call needs a manifest permission. */
type SurfaceWindowsApi = {
  readonly create: (options: {
    readonly focused: true;
    readonly height: number;
    readonly type: "popup";
    readonly url: string;
    readonly width: number;
  }) => Promise<{ readonly id?: number } | undefined>;
  readonly update: (windowId: number, info: { readonly focused: true }) => Promise<unknown>;
};

/** Browser members the fallback reads, each optional so absence degrades. */
export type SurfaceFallbackBrowser = {
  readonly runtime?: { readonly getURL?: (path: string) => string };
  readonly windows?: Partial<SurfaceWindowsApi>;
};

/** Injected effects, so tests control the channel and the timer. */
export type SurfaceFallbackDeps = {
  readonly browser: SurfaceFallbackBrowser | undefined;
  readonly channel: () => SurfacePresenceChannel | null;
  readonly schedule: (onElapsed: () => void, ms: number) => () => void;
};

/** What the approval surface calls after trying the side panel. */
export type SurfaceFallback = {
  /** The panel resolved: open the window only if no wallet page is visible. */
  readonly confirm: () => Promise<void>;
  /** The panel was refused: open (or focus) the wallet window now. */
  readonly open: () => Promise<void>;
};

/**
 * Creates the fallback, or returns undefined when this browser cannot open a
 * window, in which case callers keep their previous behavior.
 */
export const createSurfaceFallback = ({
  browser,
  channel,
  schedule,
}: SurfaceFallbackDeps): SurfaceFallback | undefined => {
  const windows = browser?.windows;
  const getURL = browser?.runtime?.getURL;
  const create = windows?.create;
  const update = windows?.update;
  if (!create || !update || !getURL) {
    return undefined;
  }
  let windowId: number | undefined;
  let opening: Promise<void> | null = null;

  const openWindow = async (): Promise<void> => {
    if (windowId !== undefined) {
      try {
        await update(windowId, { focused: true });
        return;
      } catch {
        // The user closed it; open a fresh one below.
        windowId = undefined;
      }
    }
    const created = await create({
      focused: true,
      type: "popup",
      url: getURL("sidepanel.html"),
      ...WINDOW_SIZE,
    });
    windowId = typeof created?.id === "number" ? created.id : undefined;
  };

  // Concurrent requests share one opening, so two tabs asking at once still
  // produce a single window between them.
  const open = (): Promise<void> => {
    opening ??= openWindow().finally(() => {
      opening = null;
    });
    return opening;
  };

  // Resolves true as soon as any wallet page reports itself visible, false at
  // the timeout. With no channel there is no way to tell, so it assumes the
  // panel is fine rather than risk opening a second, unwanted one.
  const anySurfaceVisible = (): Promise<boolean> =>
    new Promise((resolve) => {
      const presence = channel();
      if (!presence) {
        resolve(true);
        return;
      }
      let cancel = (): void => undefined;
      const finish = (visible: boolean): void => {
        cancel();
        presence.removeEventListener("message", onMessage);
        presence.close();
        resolve(visible);
      };
      const onMessage = (event: { readonly data: unknown }): void => {
        if (readSurfacePresenceMessage(event.data)?.type === "visible") {
          finish(true);
        }
      };
      presence.addEventListener("message", onMessage);
      cancel = schedule(() => finish(false), PRESENCE_TIMEOUT_MS);
      presence.postMessage({ type: "probe" });
    });

  return {
    confirm: async () => {
      if (!(await anySurfaceVisible())) {
        await open();
      }
    },
    open,
  };
};

/** Production wiring: a real BroadcastChannel and `setTimeout`. */
export const createBrowserSurfaceFallback = (
  browser: SurfaceFallbackBrowser | undefined,
): SurfaceFallback | undefined =>
  createSurfaceFallback({
    browser,
    channel: () =>
      typeof BroadcastChannel === "function"
        ? new BroadcastChannel(SURFACE_PRESENCE_CHANNEL)
        : null,
    schedule: (onElapsed, ms) => {
      const handle = setTimeout(onElapsed, ms);
      return () => clearTimeout(handle);
    },
  });
