/**
 * Allowance-manager bindings: one-tap revoke that submits `approve(spender, 0)`
 * through the verified send path and refreshes the tracked list.
 */
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorMessage, showToast } from "../../shared/dom";

/**
 * Dependencies the allowance bindings close over.
 */
export type AllowanceUiDeps = {
  readonly app: Element | null;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly wallet: SidepanelWallet;
};

/**
 * Binds the revoke buttons on the allowance flow.
 */
export const bindAllowances = ({ app, render, wallet }: AllowanceUiDeps): void => {
  const result = app?.querySelector<HTMLElement>("#allowance-result");
  app?.querySelectorAll<HTMLButtonElement>("[data-revoke-allowance]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["revokeAllowance"];
      if (!id) {
        return;
      }
      buttonBusy(button, true);
      if (result) {
        result.textContent = "Submitting revoke...";
      }
      void wallet.revokeAllowance(id).then(
        async (transactionHash) => {
          showToast("Revoke submitted", "success");
          if (result) {
            result.textContent = `Submitted ${transactionHash}`;
          }
          await render(await wallet.loadStatus());
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Revoke failed"), "error");
          if (result) {
            result.textContent = errorMessage(error, "Revoke failed");
          }
          buttonBusy(button, false);
        },
      );
    });
  });
};
