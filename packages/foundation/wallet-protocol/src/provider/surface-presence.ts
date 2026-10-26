/**
 * Lets the background ask whether a wallet page is actually on screen.
 *
 * Arc accepts `chrome.sidePanel.open()`, resolves it, loads `sidepanel.html`
 * and never draws it (#690), so the API result alone cannot tell the
 * background that the user sees nothing. Every wallet page therefore answers a
 * probe on this channel when its document is visible, and announces itself as
 * soon as it becomes visible. A BroadcastChannel is same-origin only, so only
 * this extension's own pages can take part; content scripts and web pages
 * cannot join it.
 */

/** Channel shared by the background and every wallet page. */
export const SURFACE_PRESENCE_CHANNEL = "bramble.surface-presence";

/**
 * A probe from the background, or a wallet page saying it is visible. Nothing
 * else crosses the channel, and no wallet data ever does.
 */
export type SurfacePresenceMessage = { readonly type: "probe" } | { readonly type: "visible" };

/** Parses one channel message, or returns null for anything else. */
export const readSurfacePresenceMessage = (value: unknown): SurfacePresenceMessage | null => {
  if (typeof value !== "object" || value === null || Object.keys(value).length !== 1) {
    return null;
  }
  const type = (value as { readonly type?: unknown }).type;
  return type === "probe" || type === "visible" ? { type } : null;
};

/** The slice of BroadcastChannel both ends use; tests inject a fake. */
export type SurfacePresenceChannel = {
  readonly addEventListener: (
    type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ) => void;
  readonly close: () => void;
  readonly postMessage: (message: SurfacePresenceMessage) => void;
  readonly removeEventListener: (
    type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ) => void;
};

/** The slice of Document a wallet page reports from. */
export type SurfacePresenceDocument = {
  readonly addEventListener: (type: "visibilitychange", listener: () => void) => void;
  readonly visibilityState: string;
};

/**
 * Makes this wallet page answer presence probes for its lifetime. It speaks
 * only while visible: a page Arc has loaded but never drawn stays silent, which
 * is exactly the signal the background's fallback waits for.
 */
export const reportSurfacePresence = (
  channel: SurfacePresenceChannel,
  page: SurfacePresenceDocument,
): void => {
  const announce = (): void => {
    if (page.visibilityState === "visible") {
      channel.postMessage({ type: "visible" });
    }
  };
  channel.addEventListener("message", (event) => {
    if (readSurfacePresenceMessage(event.data)?.type === "probe") {
      announce();
    }
  });
  page.addEventListener("visibilitychange", announce);
  announce();
};
