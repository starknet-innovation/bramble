/**
 * Browser boundary for opening the wallet approval surface from a dapp gesture.
 */
import { isRecord } from "../shared/json";
import { APPROVAL_SURFACE_MESSAGES, type RuntimeSender } from "./senders";

/**
 * Minimal Chrome side-panel boundary used to open approval UI. Failures are
 * intentionally non-fatal because message validation and approval settlement
 * remain authoritative even when the browser refuses to open a surface.
 */
export type ApprovalSurface = {
  readonly open: (options: { readonly tabId: number }) => Promise<void>;
};

/**
 * Opens the wallet beside the dapp for messages that may require approval.
 * This must be called synchronously from the runtime listener to preserve the
 * page's transient user activation; it never changes or approves the request.
 */
export const requestApprovalSurface = (
  surface: ApprovalSurface | undefined,
  extensionId: string,
  message: unknown,
  sender: RuntimeSender | undefined,
): void => {
  if (
    !surface ||
    sender?.id !== extensionId ||
    typeof sender.tab?.id !== "number" ||
    !isRecord(message) ||
    typeof message.type !== "string" ||
    !APPROVAL_SURFACE_MESSAGES.has(message.type)
  ) {
    return;
  }
  void surface.open({ tabId: sender.tab.id }).catch(() => undefined);
};
