/**
 * Browser boundary for opening the wallet approval surface from a dapp gesture.
 */

import { isRecord } from "@mc-wallet/core/json";
import type { OriginGuard } from "@mc-wallet/permissions/blocklist";
import type { ApprovalSurfacePreference } from "@mc-wallet/settings/preferences";
import { APPROVAL_SURFACE_MESSAGES, type RuntimeSender, senderOrigins } from "../routing/senders";

/**
 * Minimal Chrome UI boundaries used to configure and open approval UI.
 */
export type ApprovalSurfaceBrowser = {
  readonly action?: {
    readonly openPopup?: (options?: { readonly windowId?: number }) => Promise<void>;
    readonly setPopup?: (details: { readonly popup: string }) => Promise<void>;
  };
  readonly sidePanel?: {
    readonly open: (options: { readonly tabId: number }) => Promise<void>;
    readonly setPanelBehavior?: (behavior: {
      readonly openPanelOnActionClick: boolean;
    }) => Promise<void>;
  };
};

/**
 * Keeps toolbar activation aligned with the user's approval-surface choice.
 * Browser API failures are returned to the caller but never mutate wallet data.
 */
export const configureApprovalSurface = async (
  browser: ApprovalSurfaceBrowser | undefined,
  preference: ApprovalSurfacePreference,
): Promise<void> => {
  const jobs: Promise<void>[] = [];
  if (browser?.action?.setPopup) {
    jobs.push(browser.action.setPopup({ popup: preference === "popup" ? "popup.html" : "" }));
  }
  if (browser?.sidePanel?.setPanelBehavior) {
    jobs.push(
      browser.sidePanel.setPanelBehavior({
        openPanelOnActionClick: preference === "side-panel",
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
 * user decision. This is a shape check only: it makes no origin or rate
 * judgement, both of which the opener applies separately before opening.
 */
const surfaceRequestTabId = (
  message: unknown,
  sender: RuntimeSender | undefined,
  extensionId: string,
): number | null => {
  const tabId = sender?.id === extensionId ? sender.tab?.id : undefined;
  if (typeof tabId !== "number" || !isRecord(message) || message["silent"] === true) {
    return null;
  }
  const type = message["type"];
  return typeof type === "string" && APPROVAL_SURFACE_MESSAGES.has(type) ? tabId : null;
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
 * Raises the user's chosen surface for one tab. Browser failures fall back to
 * the side panel and are otherwise swallowed, because the queued approval — not
 * this call — is what the user ultimately acts on.
 */
const raiseSurface = (
  browser: ApprovalSurfaceBrowser,
  preference: ApprovalSurfacePreference,
  tabId: number,
  windowId: number | undefined,
): void => {
  if (preference === "popup" && browser.action?.openPopup) {
    const options = typeof windowId === "number" ? { windowId } : undefined;
    void browser.action
      .openPopup(options)
      .catch(() => browser.sidePanel?.open({ tabId }))
      .catch(() => undefined);
    return;
  }
  void browser.sidePanel?.open({ tabId }).catch(() => undefined);
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
    const tabId = surfaceRequestTabId(message, sender, extensionId);
    if (tabId === null) {
      return;
    }
    if (isGatedSender(sender, guard) || coolingDown(tabId, now())) {
      return;
    }
    raiseSurface(browser, preference(), tabId, sender?.tab?.windowId);
  };
};
