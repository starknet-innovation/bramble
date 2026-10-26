/**
 * The one-time notice after the toolbar click proved this browser never draws
 * side panels (issue 690, Arc), and the background switched the request surface to
 * the compact popup. Shown once, in the popup only, until the user dismisses
 * it. Built with DOM calls and text only, like the update banner.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { isPopupSurface } from "../shared/dom";

/** Notice title. */
export const SIDE_PANEL_NOTICE_TITLE = "Bramble opens as a popup here";

/** Notice body: why, and where to change it. */
export const SIDE_PANEL_NOTICE_BODY =
  "This browser doesn't show side panels. Change this in Settings → Request display.";

/** The dismiss control. */
export const SIDE_PANEL_NOTICE_DISMISS = "Got it";

const NOTICE_ID = "side-panel-notice";

type Send = (message: unknown) => Promise<unknown>;

/**
 * The popup's notice client. `sidePanelNoticeDue` resolves false on any
 * unexpected answer, so a failed read shows nothing; the dismissal never
 * rejects.
 */
export const createSidePanelNoticeClient = (sendMessage: Send) => ({
  async sidePanelNoticeDue(): Promise<boolean> {
    const response = await sendMessage({ type: "wallet.sidePanelNotice" }).catch(() => null);
    return (
      isRecord(response) &&
      hasOnlyKnownKeys(response, ["notice", "ok"]) &&
      response["ok"] === true &&
      response["notice"] === true
    );
  },
  async dismissSidePanelNotice(): Promise<void> {
    await sendMessage({ type: "wallet.dismissSidePanelNotice" }).catch(() => undefined);
  },
});

/**
 * Shows the notice when it is due and this page is the popup. The side panel
 * and the full-page tab never show it: there the surface already works.
 */
export const startSidePanelNotice = async ({
  doc,
  notice,
}: {
  readonly doc: Document;
  readonly notice: ReturnType<typeof createSidePanelNoticeClient>;
}): Promise<void> => {
  if (!isPopupSurface(doc.body) || doc.getElementById(NOTICE_ID)) return;
  if (!(await notice.sidePanelNoticeDue())) return;
  const holder = doc.createElement("section");
  holder.id = NOTICE_ID;
  holder.className = "callout";
  holder.setAttribute("role", "status");
  const copy = doc.createElement("span");
  copy.className = "callout-copy";
  const title = doc.createElement("strong");
  title.textContent = SIDE_PANEL_NOTICE_TITLE;
  const body = doc.createElement("p");
  body.textContent = SIDE_PANEL_NOTICE_BODY;
  copy.append(title, body);
  const dismiss = doc.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = SIDE_PANEL_NOTICE_DISMISS;
  dismiss.addEventListener("click", () => {
    holder.remove();
    void notice.dismissSidePanelNotice();
  });
  holder.append(copy, dismiss);
  doc.body.prepend(holder);
};
