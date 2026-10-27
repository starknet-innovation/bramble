/**
 * The one-time "opens as a popup" notice (#690): extension-page commands that
 * read and dismiss it. They touch no key material and no wallet data.
 */

import { readTypeOnlyInput } from "../routing/message-inputs";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { SidePanelLearner } from "./side-panel-learning";

/** The learner's notice slice; absent in contexts with no learner. */
export type SidePanelNotice = Pick<SidePanelLearner, "dismissNotice" | "notice">;

/**
 * Handles `wallet.sidePanelNotice` and `wallet.dismissSidePanelNotice`, or
 * returns null for any other message. With no learner the notice is never due.
 */
export const handleSidePanelNoticeOps = async (
  learner: SidePanelNotice | undefined,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType !== "wallet.sidePanelNotice" && messageType !== "wallet.dismissSidePanelNotice") {
    return null;
  }
  if (!readTypeOnlyInput(message, messageType)) {
    return { error: "Invalid side panel notice request" };
  }
  if (messageType === "wallet.sidePanelNotice") {
    return { notice: (await learner?.notice()) ?? false, ok: true };
  }
  await learner?.dismissNotice();
  return { ok: true };
};
