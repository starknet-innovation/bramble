/**
 * Send-flow review/confirm bindings plus activity refresh and CSV export.
 * The review step renders decoded summaries, risk flags, and the fee estimate
 * before anything is signed.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { isStarkFieldElement } from "../starknet/networks";
import { activityToCsv } from "../storage/activity-store";
import { buttonBusy, errorMessage, showToast } from "./dom";
import { formatFri } from "./parts";
import type { SidepanelWallet } from "./runtime";

const INVALID_RECIPIENT_MESSAGE = "Enter a valid Starknet address.";

/** Background error string returned when the recipient fails validation. */
const INVALID_REVIEW_ERROR = "invalid transfer review request";

/**
 * Returns an inline error message when the recipient is not a well-formed
 * Starknet address, or `null` when it is valid. Mirrors the background's
 * `isStarkFieldElement` check so the send form rejects the same addresses the
 * wallet would refuse, instead of surfacing a developer error string.
 */
export const recipientFieldError = (recipient: string): string | null =>
  isStarkFieldElement(recipient) ? null : INVALID_RECIPIENT_MESSAGE;

/**
 * Maps the background's developer error string for a malformed recipient onto
 * the same friendly, inline message; passes every other error through.
 */
export const friendlyReviewError = (error: unknown): string => {
  const message = errorMessage(error, "Transfer review failed");
  return message === INVALID_REVIEW_ERROR ? INVALID_RECIPIENT_MESSAGE : message;
};

/**
 * Dependencies the transfer and activity bindings close over.
 */
export type TransferUiDeps = {
  readonly app: Element | null;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly wallet: SidepanelWallet;
};

const transferFields = (form: HTMLFormElement) => {
  const data = new FormData(form);
  return {
    accountId: String(data.get("accountId") ?? ""),
    amount: String(data.get("amount") ?? "").trim(),
    recipient: String(data.get("recipient") ?? "").trim(),
    speed: data.get("speed") === "fast" ? ("fast" as const) : ("standard" as const),
    tokenId: String(data.get("tokenId") ?? ""),
  };
};

const reviewPanelHtml = (
  review: Awaited<ReturnType<SidepanelWallet["reviewTransfer"]>>,
): string => `
  <div class="review-panel" role="note">
    ${review.summaries.map((summary) => `<p>${escapeHtml(summary)}</p>`).join("")}
    ${review.flags.map((flag) => `<p class="review-flag">⚠ ${escapeHtml(flag.message)}</p>`).join("")}
    ${
      review.requiresDeployment
        ? '<p class="review-flag">⚠ This account is not deployed yet; the first send also submits its deployment.</p>'
        : ""
    }
    <p class="review-fee">${review.fee ? `Estimated fee: ${escapeHtml(formatFri(review.fee.overallFee))}` : "Fee estimate unavailable."}</p>
  </div>`;

/**
 * Binds the two-phase send form: review with decoded summary, flags, and fee,
 * then confirm.
 */
export const bindTransfer = ({ app, wallet }: TransferUiDeps): void => {
  const form = app?.querySelector<HTMLFormElement>("#transfer-form");
  const result = app?.querySelector<HTMLElement>("#transfer-result");
  const reviewPanel = app?.querySelector<HTMLElement>("#review-panel");
  const recipientInput = form?.querySelector<HTMLInputElement>('input[name="recipient"]');
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  let reviewedKey: string | null = null;

  const resetReview = (): void => {
    reviewedKey = null;
    recipientInput?.setCustomValidity("");
    if (reviewPanel) {
      reviewPanel.innerHTML = "";
    }
    if (submitButton) {
      submitButton.lastChild?.replaceWith("Review send");
    }
  };

  form?.addEventListener("input", resetReview);

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const fields = transferFields(form);

    const recipientError = recipientFieldError(fields.recipient);
    if (recipientError) {
      recipientInput?.setCustomValidity(recipientError);
      recipientInput?.reportValidity();
      if (result) {
        result.textContent = recipientError;
      }
      return;
    }

    const key = JSON.stringify(fields);
    buttonBusy(submitButton, true);

    if (reviewedKey !== key) {
      void wallet
        .reviewTransfer(fields.accountId, fields.tokenId, fields.recipient, fields.amount)
        .then(
          (review) => {
            reviewedKey = key;
            if (reviewPanel) {
              reviewPanel.innerHTML = reviewPanelHtml(review);
            }
            if (submitButton) {
              submitButton.lastChild?.replaceWith("Confirm send");
            }
            if (result) {
              result.textContent = "Review the details above, then confirm.";
            }
            buttonBusy(submitButton, false);
          },
          (error: unknown) => {
            const message = friendlyReviewError(error);
            showToast(message, "error");
            if (result) {
              result.textContent = message;
            }
            buttonBusy(submitButton, false);
          },
        );
      return;
    }

    void wallet
      .submitTransfer(
        fields.accountId,
        fields.tokenId,
        fields.recipient,
        fields.amount,
        fields.speed,
      )
      .then(
        (transactionHash) => {
          showToast("Transaction submitted", "success");
          if (result) {
            result.textContent = `Submitted ${transactionHash}`;
          }
          form.reset();
          resetReview();
          buttonBusy(submitButton, false);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Transfer failed"), "error");
          if (result) {
            result.textContent = errorMessage(error, "Transfer failed");
          }
          buttonBusy(submitButton, false);
        },
      );
  });
};

/**
 * Binds the activity screen refresh and CSV export controls.
 */
export const bindActivity = ({ app, render, wallet }: TransferUiDeps): void => {
  const refreshButton = app?.querySelector<HTMLButtonElement>("#activity-refresh");
  const exportButton = app?.querySelector<HTMLButtonElement>("#activity-export");

  refreshButton?.addEventListener("click", () => {
    buttonBusy(refreshButton, true);
    void wallet.loadStatus().then(render, () => buttonBusy(refreshButton, false));
  });

  exportButton?.addEventListener("click", () => {
    buttonBusy(exportButton, true);
    void wallet.loadActivity().then(
      (entries) => {
        const blob = new Blob([activityToCsv(entries)], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "mc-wallet-activity.csv";
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast("Activity exported", "success");
        buttonBusy(exportButton, false);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Export failed"), "error");
        buttonBusy(exportButton, false);
      },
    );
  });
};
