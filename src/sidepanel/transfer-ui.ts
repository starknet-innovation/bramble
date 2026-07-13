/**
 * Send-flow review/confirm bindings plus activity refresh and CSV export.
 * The review step renders decoded summaries, risk flags, and the fee estimate
 * before anything is signed.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { isStarkFieldElement, normalizeFeltInput } from "../starknet/networks";
import { activityToCsv } from "../storage/activity-store";
import { buttonBusy, errorMessage, showToast } from "./dom";
import { formatFri } from "./parts";
import type { SidepanelWallet } from "./runtime";

const INVALID_RECIPIENT_MESSAGE = "Enter a valid Starknet address.";

/** Background error string returned when the recipient fails validation. */
const INVALID_REVIEW_ERROR = "invalid transfer review request";

/**
 * Returns an inline error message when the recipient is not a well-formed
 * Starknet address, or `null` when it is valid. Normalizes first so a
 * checksummed (mixed-case) `0x` address is accepted — hex is case-insensitive,
 * so it denotes the same felt — then mirrors the background's
 * `isStarkFieldElement` check on the normalized value, rejecting the same
 * addresses the wallet would refuse instead of surfacing a developer error.
 */
export const recipientFieldError = (recipient: string): string | null =>
  isStarkFieldElement(normalizeFeltInput(recipient)) ? null : INVALID_RECIPIENT_MESSAGE;

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
    recipient: normalizeFeltInput(String(data.get("recipient") ?? "")),
    speed: data.get("speed") === "fast" ? ("fast" as const) : ("standard" as const),
    tokenId: String(data.get("tokenId") ?? ""),
  };
};

type Review = Awaited<ReturnType<SidepanelWallet["reviewTransfer"]>>;

// Renders the fee line: a numeric estimate when available, an informational
// note when the account still needs deployment, or a friendly failure message
// plus a retry control when a deployed account's estimate genuinely failed.
const feeLineHtml = (review: Review): string => {
  if (review.fee) {
    return `<p class="review-fee">Estimated fee: ${escapeHtml(formatFri(review.fee.overallFee))}</p>`;
  }
  if (review.requiresDeployment) {
    return '<p class="review-fee">The network fee is estimated once this account is deployed.</p>';
  }
  if (review.feeEstimateFailed) {
    return '<p class="review-flag" role="alert">Couldn\'t estimate the network fee right now. Check your connection and retry before sending.</p><button type="button" class="secondary" id="review-retry-fee">Retry fee estimate</button>';
  }
  return "";
};

const reviewPanelHtml = (review: Review): string => `
  <div class="review-panel" role="note">
    ${review.summaries.map((summary) => `<p>${escapeHtml(summary)}</p>`).join("")}
    ${review.flags.map((flag) => `<p class="review-flag">⚠ ${escapeHtml(flag.message)}</p>`).join("")}
    ${
      review.requiresDeployment
        ? '<p class="review-flag">⚠ This account is not deployed yet; the first send also submits its deployment.</p>'
        : ""
    }
    ${feeLineHtml(review)}
  </div>`;

/**
 * Binds the two-phase send form: review with decoded summary, flags, and fee,
 * then confirm.
 */
export const bindTransfer = ({ app, wallet }: TransferUiDeps): void => {
  const form = app?.querySelector<HTMLFormElement>("#transfer-form");
  if (!form) {
    return;
  }
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
    // A failed estimate leaves the submit button disabled; editing any field
    // clears the review, so re-enable it for the next review pass.
    buttonBusy(submitButton, false);
  };

  form.addEventListener("input", resetReview);

  form.addEventListener("submit", (event) => {
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
            const feeFailed = review.feeEstimateFailed;
            reviewedKey = feeFailed ? null : key;
            if (reviewPanel) {
              reviewPanel.innerHTML = reviewPanelHtml(review);
            }
            if (submitButton) {
              submitButton.lastChild?.replaceWith(feeFailed ? "Review send" : "Confirm send");
            }
            if (result) {
              result.textContent = feeFailed
                ? "Fee estimate failed. Retry the fee estimate before sending."
                : "Review the details above, then confirm.";
            }
            reviewPanel
              ?.querySelector<HTMLButtonElement>("#review-retry-fee")
              ?.addEventListener("click", () => {
                form.requestSubmit();
              });
            buttonBusy(submitButton, feeFailed);
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
