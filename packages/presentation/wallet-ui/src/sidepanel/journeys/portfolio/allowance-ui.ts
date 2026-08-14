/**
 * Allowance-manager bindings: one-tap revoke that submits `approve(spender, 0)`
 * through the verified send path and refreshes the tracked list.
 */
import type { FeeEstimate } from "@mc-wallet/starknet/fee-bounds";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorMessage, showToast } from "../../shared/dom";
import { formatFeeEstimate } from "../../shared/review-render";

const REVIEWED_FEES = new WeakMap<HTMLButtonElement, FeeEstimate>();

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
      const reviewedFee = REVIEWED_FEES.get(button);
      if (reviewedFee) REVIEWED_FEES.delete(button);
      void wallet.revokeAllowance(id, reviewedFee).then(
        async (response) => {
          if (typeof response !== "string") {
            REVIEWED_FEES.set(button, response);
            const fee = formatFeeEstimate(response);
            if (result) result.textContent = `Maximum network fee: ${fee}`;
            button.lastChild?.replaceWith(`Confirm revoke · ${fee}`);
            buttonBusy(button, false);
            return;
          }
          showToast("Revoke submitted", "success");
          if (result) {
            result.textContent = `Submitted ${response}`;
          }
          await render(await wallet.loadStatus());
        },
        (error: unknown) => {
          REVIEWED_FEES.delete(button);
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
