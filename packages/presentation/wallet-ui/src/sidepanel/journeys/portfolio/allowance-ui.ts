/**
 * Allowance-manager bindings: one-tap revoke that submits `approve(spender, 0)`
 * through the verified send path and refreshes the tracked list.
 */
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { failureTone, isOutcomeUnknown } from "../../runtime/runtime-errors";
import { buttonBusy, errorDetails, errorLine, showToast } from "../../shared/dom";
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
  const refresh = app?.querySelector<HTMLButtonElement>("#allowance-refresh");
  refresh?.addEventListener("click", () => {
    buttonBusy(refresh, true);
    void wallet
      .loadStatus()
      .then(render)
      .catch((error: unknown) => {
        showToast(errorDetails(error, "Allowance refresh failed"), "error", refresh);
        buttonBusy(refresh, false);
      });
  });
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
          ? "Submitting…"
          : "Estimating the maximum fee…";
      }
      if (result) {
        result.textContent = "";
      }
      const reviewedFee = REVIEWED_FEES.get(button);
      if (reviewedFee) REVIEWED_FEES.delete(button);
      void wallet.revokeAllowance(id, reviewedFee).then(
        (response) => {
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
          if (review) review.textContent = "Revoke submitted. Follow it in Activity.";
        },
        (error: unknown) => {
          REVIEWED_FEES.delete(button);
          // A revoke whose reply was lost may be on chain: amber, and the
          // button stays down until the list repaints (errors audit F3).
          showToast(errorDetails(error, "Revoke failed"), failureTone(error), button);
          if (result) {
            result.textContent = errorLine(error, "Revoke failed");
          }
          if (review) review.textContent = errorLine(error, "Revoke failed");
          if (!isOutcomeUnknown(error)) buttonBusy(button, false);
        },
      );
    });
  });
};
