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
      const review = button
        .closest(".allowance-row")
        ?.querySelector<HTMLElement>("[data-allowance-review-for]");
      buttonBusy(button, true);
      if (review) {
        review.hidden = false;
        review.textContent = REVIEWED_FEES.has(button)
          ? "Submitting the reviewed revoke…"
          : "Preparing the revoke and estimating its maximum fee…";
      }
      if (result) {
        result.textContent = "";
      }
      const reviewedFee = REVIEWED_FEES.get(button);
      if (reviewedFee) REVIEWED_FEES.delete(button);
      void wallet.revokeAllowance(id, reviewedFee).then(
        async (response) => {
          if (typeof response !== "string") {
            REVIEWED_FEES.set(button, response);
            const fee = formatFeeEstimate(response);
            if (review)
              review.textContent = `Maximum network fee: ${fee}. Confirm to set this spender's allowance to zero.`;
            button.lastChild?.replaceWith(`Confirm revoke · ${fee}`);
            buttonBusy(button, false);
            return;
          }
          showToast("Revoke submitted", "success", button);
          if (result) {
            result.textContent = `Submitted ${response}`;
          }
          if (review)
            review.textContent = "Revoke submitted. Activity will show its network status.";
          await render(await wallet.loadStatus());
        },
        (error: unknown) => {
          REVIEWED_FEES.delete(button);
          showToast(errorMessage(error, "Revoke failed"), "error", button);
          if (result) {
            result.textContent = errorMessage(error, "Revoke failed");
          }
          if (review) review.textContent = errorMessage(error, "Revoke failed");
          buttonBusy(button, false);
        },
      );
    });
  });
};
