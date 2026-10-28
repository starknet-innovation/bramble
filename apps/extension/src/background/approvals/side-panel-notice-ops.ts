/**
 * The side panel learning's extension-page commands (#690): read and dismiss
 * the one-time "opens as a popup" notice, and the side panel page's report
 * that it is visible. They touch no key material and no wallet data.
 */

import { readTypeOnlyInput } from "../routing/message-inputs";
import type { RuntimeSender } from "../routing/senders";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { SidePanelLearner } from "./side-panel-learning";

/** The learner's slice the router reaches; absent in contexts with no learner. */
export type SidePanelNotice = Pick<SidePanelLearner, "dismissNotice" | "notice" | "observeVisible">;

const TYPES = new Set([
  "wallet.dismissSidePanelNotice",
  "wallet.sidePanelNotice",
  "wallet.sidePanelVisible",
]);

/**
 * Handles `wallet.sidePanelNotice`, `wallet.dismissSidePanelNotice` and
 * `wallet.sidePanelVisible`, or returns null for any other message. With no
 * learner the notice is never due. The router admits only this extension's
 * pages; the learner further accepts a visible report only from the side
 * panel page itself, outside any tab.
 */
export const handleSidePanelNoticeOps = async (
  learner: SidePanelNotice | undefined,
  messageType: string,
  message: unknown,
  sender?: RuntimeSender,
): Promise<RuntimeResponse | null> => {
  if (!TYPES.has(messageType)) return null;
  if (!readTypeOnlyInput(message, messageType)) {
    return { error: "Invalid side panel notice request" };
  }
  if (messageType === "wallet.sidePanelNotice") {
    return { notice: (await learner?.notice()) ?? false, ok: true };
  }
  if (messageType === "wallet.sidePanelVisible") {
    learner?.observeVisible(sender);
    return { ok: true };
  }
  await learner?.dismissNotice();
  return { ok: true };
};
