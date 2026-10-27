/**
 * Browser boundary for opening the wallet approval surface from a dapp gesture.
 */

import type { OriginGuard } from "@bramble/permissions/blocklist";
import type { ApprovalSurfacePreference } from "@bramble/settings/preferences";
import { isSenderOrigin, type RuntimeSender, senderOrigins } from "../routing/senders";
import { readApprovalSurfaceRequest } from "./approval-surface-request";
import type { RescueAttempt, SurfaceRescue } from "./approval-surface-rescue";

/**
 * Minimal browser UI boundaries used to configure and open approval UI.
 *
 * `sidePanel` and `sidebarAction` are the same surface under two APIs:
 * Chromium opens its side panel for a named tab, Firefox opens its sidebar for
 * the active window and takes no argument. Every member is optional so one
 * shape covers both, and a runtime offering neither panel API degrades to the
 * toolbar popup rather than throwing — the queued approval, not the opening,
 * is what the user ultimately acts on.
 */
export type ApprovalSurfaceBrowser = {
  readonly action?: {
    readonly onClicked?: {
      readonly addListener: (listener: (tab?: { readonly windowId?: number }) => void) => void;
    };
    readonly openPopup?: (options?: { readonly windowId?: number }) => Promise<void>;
    readonly setBadgeText?: (details: { readonly text: string }) => Promise<void>;
    readonly setPopup?: (details: { readonly popup: string }) => Promise<void>;
  };
  readonly sidePanel?: {
    readonly open: (options: { readonly tabId: number }) => Promise<void>;
    readonly setPanelBehavior?: (behavior: {
      readonly openPanelOnActionClick: boolean;
    }) => Promise<void>;
  };
  readonly sidebarAction?: {
    readonly open: () => Promise<void>;
  };
};

/**
 * Opens the wallet panel through whichever API this browser provides. Resolves
 * silently when neither exists, matching the rest of this module: a surface
 * that will not open is never allowed to become a wallet error.
 */
const openPanel = (browser: ApprovalSurfaceBrowser, tabId: number): Promise<void> =>
  browser.sidePanel?.open({ tabId }) ?? browser.sidebarAction?.open() ?? Promise.resolve();

/**
 * Largest pending count the toolbar badge shows before going to "9+". A badge
 * is a handful of pixels; a four-digit number renders as an unreadable smear.
 */
const BADGE_LIMIT = 9;

/**
 * Marks the toolbar button with the number of approvals waiting, or clears it
 * at zero.
 *
 * On Chromium this is a convenience. On Firefox it is what tells the user a
 * dapp is waiting when their surface is the sidebar: `sidebarAction.open` may
 * only be called while handling a user action, and a `runtime.onMessage`
 * handler reacting to a click on a web page does not count as one — Mozilla
 * documents that case exactly. So a dapp-triggered approval cannot raise the
 * sidebar itself. It queues, this badge appears, and the user's click on the
 * toolbar button is the real gesture that opens the panel through
 * {@link bindToolbarActivation}. The popup surface is freed from that limit
 * only from Firefox 149, which made `action.openPopup` work without a
 * gesture; this build's minimum Firefox is lower, so there a dapp-triggered
 * popup can be refused too, and this badge is what remains.
 *
 * Browser failures are swallowed for the same reason every other call in this
 * module swallows them: the queued approval, not its announcement, is what the
 * user ultimately acts on.
 */
export const showPendingApprovals = (
  browser: ApprovalSurfaceBrowser | undefined,
  pending: number,
): void => {
  const setBadgeText = browser?.action?.setBadgeText;
  if (!setBadgeText) {
    return;
  }
  const text = pending <= 0 ? "" : pending > BADGE_LIMIT ? `${BADGE_LIMIT}+` : `${pending}`;
  void setBadgeText({ text }).catch(() => undefined);
};

/**
 * Opens the Firefox sidebar from a toolbar click.
 *
 * Chromium routes the toolbar button to the side panel itself through
 * `setPanelBehavior`, so nothing is bound there. Firefox has no such behavior:
 * with no popup set its toolbar button only fires `action.onClicked`, and
 * without this the button would do nothing in the side-panel preference. The
 * listener is registered once at startup because `sidebarAction.open` requires
 * the user gesture the click carries, and it opens nothing when the user has
 * chosen the popup — in that case a popup is set and this never fires.
 */
export const bindToolbarActivation = (
  browser: ApprovalSurfaceBrowser | undefined,
  preference: () => ApprovalSurfacePreference,
): void => {
  const sidebarAction = browser?.sidebarAction;
  if (browser?.sidePanel || !sidebarAction?.open) {
    return;
  }
  browser?.action?.onClicked?.addListener(() => {
    if (preference() !== "popup") {
      // Called synchronously inside the click handler: awaiting anything first
      // would lose the user-action status this API requires.
      void sidebarAction.open().catch(() => undefined);
    }
  });
};

/**
 * Keeps toolbar activation aligned with the user's approval-surface choice.
 * `nativePanelClick` is false while the side panel is still being learned
 * (./side-panel-learning): the toolbar click then reaches `action.onClicked`
 * instead of Chromium's built-in panel behavior.
 * Browser API failures are returned to the caller but never mutate wallet data.
 */
export const configureApprovalSurface = async (
  browser: ApprovalSurfaceBrowser | undefined,
  preference: ApprovalSurfacePreference,
  nativePanelClick = true,
): Promise<void> => {
  const jobs: Promise<void>[] = [];
  if (browser?.action?.setPopup) {
    jobs.push(browser.action.setPopup({ popup: preference === "popup" ? "popup.html" : "" }));
  }
  if (browser?.sidePanel?.setPanelBehavior) {
    jobs.push(
      browser.sidePanel.setPanelBehavior({
        openPanelOnActionClick: preference === "side-panel" && nativePanelClick,
      }),
    );
  }
  await Promise.all(jobs);
};

/**
 * Shortest gap between two surface openings driven by the same tab. A page can
 * emit approval-capable messages in a loop, and opening the panel needs no
 * approval of its own, so without this one tab could hold the wallet UI open
 * indefinitely. One second is below the time a user needs to read a prompt, so
 * a genuine back-to-back request is never suppressed in a way they can notice.
 */
const SURFACE_COOLDOWN_MS = 1_000;

/**
 * The tab a surface-opening request belongs to, or null when the message is not
 * one this extension's own content script may relay from a tab on behalf of a
 * user decision. The message must pass the same exact parser its execution
 * handler uses, including claimed-origin normalization.
 */
const surfaceRequest = (
  message: unknown,
  sender: RuntimeSender | undefined,
  extensionId: string,
): { readonly origin: string; readonly tabId: number } | null => {
  const tabId = sender?.id === extensionId ? sender.tab?.id : undefined;
  const request = readApprovalSurfaceRequest(message);
  if (typeof tabId !== "number" || !request || request.silent) {
    return null;
  }
  return { origin: request.origin, tabId };
};

/**
 * Whether the phishing guard bars this sender from opening the surface. Fails
 * closed on a sender the browser gave no origin for: with no origin there is
 * nothing to check against the blocklist, so it is untrusted rather than
 * unblocked. This matches every other consumer of senderOrigins in ./senders.
 */
const isGatedSender = (sender: RuntimeSender | undefined, guard: OriginGuard): boolean => {
  const origins = senderOrigins(sender);
  return origins.length === 0 || origins.some((origin) => guard.isBlocked(origin));
};

/**
 * Raises the user's chosen surface for one tab. A refused popup falls back to
 * the side panel, and a refused side panel to the rescue when one is wired
 * (./approval-surface-rescue, #707). Failures are otherwise swallowed, because
 * the queued approval — not this call — is what the user ultimately acts on.
 */
const raiseSurface = (
  browser: ApprovalSurfaceBrowser,
  preference: ApprovalSurfacePreference,
  tabId: number,
  windowId: number | undefined,
  rescue: RescueAttempt | undefined,
): void => {
  const panel = (): Promise<void> => openPanel(browser, tabId).catch(() => rescue?.());
  if (preference === "popup" && browser.action?.openPopup) {
    const options = typeof windowId === "number" ? { windowId } : undefined;
    void browser.action
      .openPopup(options)
      .catch(panel)
      .catch(() => undefined);
    return;
  }
  void panel().catch(() => undefined);
};

/**
 * Long-lived collaborators for the surface opener. The preference is read
 * through an accessor because the user can change it mid-session, and the clock
 * is injected so this browser boundary stays free of ambient time.
 */
export type ApprovalSurfaceDeps = {
  readonly browser: ApprovalSurfaceBrowser | undefined;
  readonly extensionId: string;
  readonly guard: OriginGuard;
  readonly now: () => number;
  readonly preference: () => ApprovalSurfacePreference;
  /** Runs when the side panel open is refused (#707); absent, nothing more opens. */
  readonly rescue?: SurfaceRescue;
};

/**
 * Creates the surface opener, which owns the per-tab cooldown state for the life
 * of the worker. Call the returned function synchronously from the runtime
 * message listener to preserve the page's transient user activation; it never
 * changes, queues, or approves the request, and browser failures are non-fatal
 * because the queued approval stays authoritative.
 *
 * It opens nothing unless the message is an approval-capable, non-silent dapp
 * message relayed by this extension's own content script from a tab, the sender
 * carries at least one browser-supplied origin and all of them are off the
 * phishing blocklist, and that tab has not already opened a surface within
 * {@link SURFACE_COOLDOWN_MS}. Both of those extra checks are synchronous
 * in-memory reads so the opener can stay ahead of the asynchronous message
 * gating without losing user activation.
 */
export const createApprovalSurfaceOpener = ({
  browser,
  extensionId,
  guard,
  now,
  preference,
  rescue,
}: ApprovalSurfaceDeps): ((message: unknown, sender: RuntimeSender | undefined) => void) => {
  // Last accepted opening per tab. Entries that have aged past the cooldown are
  // dropped on every call, so this stays bounded by recently active tabs.
  const openedAt = new Map<number, number>();
  const coolingDown = (tabId: number, at: number): boolean => {
    for (const [tab, previous] of openedAt) {
      if (previous > at || at - previous >= SURFACE_COOLDOWN_MS) {
        openedAt.delete(tab);
      }
    }
    if (openedAt.has(tabId)) {
      return true;
    }
    openedAt.set(tabId, at);
    return false;
  };

  return (message, sender) => {
    if (!browser) {
      return;
    }
    const request = surfaceRequest(message, sender, extensionId);
    if (!request) {
      return;
    }
    if (
      !isSenderOrigin(sender, request.origin) ||
      isGatedSender(sender, guard) ||
      coolingDown(request.tabId, now())
    ) {
      return;
    }
    const windowId = sender?.tab?.windowId;
    // Prepared now, before the request can queue its approval.
    const attempt = rescue?.({ origin: request.origin, windowId });
    raiseSurface(browser, preference(), request.tabId, windowId, attempt);
  };
};
