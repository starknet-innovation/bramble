/**
 * Binds "Don't show again" on the Home Ready key notice. The choice hides the
 * notice for that one account, as a local display preference; other affected
 * accounts keep theirs.
 */

import type { WalletStatus } from "../../../popup/responses/responses";
import type { RefreshReason } from "../../app/sync/refresh-scheduler";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorDetails, showToast } from "../../shared/dom";

/** Collaborators the dismiss control needs. */
export type ReadyKeyNoticeUiDeps = {
  readonly app: Element | null;
  readonly render: (status: WalletStatus, refreshReason?: RefreshReason) => Promise<void>;
  readonly wallet: Pick<SidepanelWallet, "loadStatus" | "setDisplay">;
};

/**
 * Wires the dismiss control when the notice is on screen. Safe to call on every
 * render. It dismisses the account named on the control, not whichever account
 * is active by the time the write lands. A failed write keeps the notice and
 * says so; nothing is retried.
 */
export const bindReadyKeyNotice = (deps: ReadyKeyNoticeUiDeps): void => {
  const hide = deps.app?.querySelector<HTMLButtonElement>("#ready-key-notice-hide");
  const accountId = hide?.dataset["accountId"];
  if (!hide || !accountId) return;
  hide.addEventListener("click", async () => {
    buttonBusy(hide, true);
    try {
      await deps.wallet.setDisplay({ readyKeyNoticeDismissed: accountId });
    } catch (error) {
      showToast(errorDetails(error, "Notice preference failed"), "error", hide);
      buttonBusy(hide, false);
      return;
    }
    await deps.render(await deps.wallet.loadStatus(), "action");
  });
};
