/**
 * Browser boundary for opening the wallet approval surface from a dapp gesture.
 */
import { isRecord } from "../shared/json";
import type { ApprovalSurfacePreference } from "../storage/preferences-store";
import { APPROVAL_SURFACE_MESSAGES, type RuntimeSender } from "./senders";

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
 * Opens the user's chosen wallet surface for messages that may require approval.
 * This must be called synchronously from the runtime listener to preserve the
 * page's transient user activation; it never changes or approves the request.
 * Failures are non-fatal because the queued approval remains authoritative.
 */
export const requestApprovalSurface = (
  browser: ApprovalSurfaceBrowser | undefined,
  preference: ApprovalSurfacePreference,
  extensionId: string,
  message: unknown,
  sender: RuntimeSender | undefined,
): void => {
  if (
    !browser ||
    sender?.id !== extensionId ||
    typeof sender.tab?.id !== "number" ||
    !isRecord(message) ||
    typeof message["type"] !== "string" ||
    message["silent"] === true ||
    !APPROVAL_SURFACE_MESSAGES.has(message["type"])
  ) {
    return;
  }
  const tabId = sender.tab.id;
  if (preference === "popup" && browser.action?.openPopup) {
    const options =
      typeof sender.tab.windowId === "number" ? { windowId: sender.tab.windowId } : undefined;
    void browser.action
      .openPopup(options)
      .catch(() => browser.sidePanel?.open({ tabId }))
      .catch(() => undefined);
    return;
  }
  void browser.sidePanel?.open({ tabId }).catch(() => undefined);
};
