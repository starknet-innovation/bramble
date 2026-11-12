/**
 * Binds "Don't show again" on the Home VIP notice (issue 688). The choice is a
 * local display preference; Settings → Appearance turns the notice back on.
 */

import { t } from "../../../i18n/messages";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { RefreshReason } from "../../app/sync/refresh-scheduler";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorDetails, showToast } from "../../shared/dom";

/** Collaborators the dismiss control needs. */
export type VipNoticeUiDeps = {
  readonly app: Element | null;
  readonly render: (status: WalletStatus, refreshReason?: RefreshReason) => Promise<void>;
  readonly wallet: Pick<SidepanelWallet, "loadStatus" | "setDisplay">;
};

/**
 * Wires the dismiss control when the notice is on screen. Safe to call on every
 * render. A failed write keeps the notice and says so; nothing is retried.
 */
export const bindVipNotice = (deps: VipNoticeUiDeps): void => {
  const hide = deps.app?.querySelector<HTMLButtonElement>("#vip-notice-hide");
  if (!hide) return;
  hide.addEventListener("click", async () => {
    buttonBusy(hide, true);
    try {
      await deps.wallet.setDisplay({ vipNotice: false });
    } catch (error) {
      showToast(errorDetails(error, t("portfolio.vip.saveFailed")), "error", hide);
      buttonBusy(hide, false);
      return;
    }
    await deps.render(await deps.wallet.loadStatus(), "action");
  });
};
