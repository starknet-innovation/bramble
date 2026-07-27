/**
 * Activity refresh and CSV-export bindings. Export always labels degraded
 * history honestly so local-only records are never mistaken for a complete
 * on-chain account history.
 */
import type { WalletStatus } from "../popup/responses";
import { activityToCsv } from "../storage/activity-store";
import { buttonBusy, errorMessage, showToast, type ToastTone } from "./dom";
import type { SidepanelWallet } from "./runtime";

/**
 * Dependencies used by the activity controls. All wallet reads stay behind the
 * permissioned runtime client and failures surface without mutating local data.
 */
export type ActivityUiDeps = {
  readonly app: Element | null;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly wallet: SidepanelWallet;
};

/**
 * Chooses the toast for a completed CSV export. A degraded export explicitly
 * names its device-only scope; a complete feed reads as plain success.
 */
export const activityExportToast = (
  historyUnavailable: boolean,
): { readonly message: string; readonly tone: ToastTone } =>
  historyUnavailable
    ? {
        message: "Exported this device's records only — on-chain history was unavailable.",
        tone: "error",
      }
    : { message: "Activity exported", tone: "success" };

/**
 * Binds the activity screen refresh and CSV export controls.
 */
export const bindActivity = ({ app, render, wallet }: ActivityUiDeps): void => {
  const refreshButton = app?.querySelector<HTMLButtonElement>("#activity-refresh");
  const exportButton = app?.querySelector<HTMLButtonElement>("#activity-export");

  refreshButton?.addEventListener("click", () => {
    buttonBusy(refreshButton, true);
    void wallet.loadStatus().then(render, () => buttonBusy(refreshButton, false));
  });

  exportButton?.addEventListener("click", () => {
    buttonBusy(exportButton, true);
    void wallet.loadActivity().then(
      ({ entries, historyUnavailable }) => {
        const blob = new Blob([activityToCsv(entries)], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "mc-wallet-activity.csv";
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        const toast = activityExportToast(historyUnavailable);
        showToast(toast.message, toast.tone);
        buttonBusy(exportButton, false);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Export failed"), "error");
        buttonBusy(exportButton, false);
      },
    );
  });
};
