/**
 * The NFT detail send journey: a read-only review, a confirmed submission
 * through the verified invoke path, and the receipt that waits for the chain.
 * Split from the gallery bindings (./nft-ui) by behaviour.
 */

import { normalizeFeltInput } from "@bramble/wallet-model/networks";
import type { TransferReviewResponse, WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { awaitConfirmation, type ConfirmationOutcome } from "../../shared/confirm-submitted";
import { buttonBusy, errorMessage, renderFragment, showToast } from "../../shared/dom";
import {
  bindOutcomeReceipt,
  outcomeReceiptFor,
  outcomeReceiptSection,
  paintOutcomeReceipt,
} from "../../shared/outcome-receipt";
import { reviewFeeBlocked } from "../../shared/review-render";
import { watchDeployment } from "../../shell/shell-bindings";
import { friendlyReviewError, recipientFieldError, reviewPanelHtml } from "../send/transfer-ui";

/**
 * What the send journey closes over. Wallet calls go through the background,
 * which re-validates every field; nothing here is trusted to authorize a send.
 */
export type NftSendDeps = {
  readonly app: Element | null;
  /** Overrides the confirmation checkpoints; tests pass a single zero delay. */
  readonly confirmationDelaysMs?: readonly number[];
  /**
   * Leaves the transfer from its receipt: Activity, or home on Back. Required
   * because the receipt is inserted after the shell binds its `data-view`
   * controls, so without it the receipt's ways off do nothing.
   */
  readonly navigate: (view: "activity" | "home") => void;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly wallet: SidepanelWallet;
};

// A transfer has nothing to itemise beyond the review above it, so the receipt
// states the outcome, says once where the token went, and shows the hash.
const paintNftReceipt = async (
  deps: NftSendDeps,
  root: ParentNode | null | undefined,
  outcome: ConfirmationOutcome | null,
  hash: string,
): Promise<void> => {
  const status = await deps.wallet.loadStatus();
  if (!root) return;
  paintOutcomeReceipt(
    root,
    "nft-success",
    outcomeReceiptFor(
      outcome,
      {
        confirmedDescription: "The collectible is now held by the recipient.",
        confirmedTitle: "Transfer complete",
        failedTitle: "Transfer failed",
        submittedTitle: "Transfer submitted",
      },
      hash,
    ),
    status.networkId,
  );
};

type NftReviewElements = {
  readonly form: HTMLFormElement;
  readonly result: HTMLElement | null | undefined;
  readonly reviewPanel: HTMLElement | null | undefined;
  readonly submitButton: HTMLButtonElement | null | undefined;
};

const renderNftTransferReview = (
  elements: NftReviewElements,
  review: TransferReviewResponse["review"],
  key: string,
  setReviewedKey: (value: string | null) => void,
  setRequiresDeployment: (value: boolean) => void,
  setReviewedFees: (
    fee: TransferReviewResponse["review"]["fee"],
    deploymentFee: TransferReviewResponse["review"]["deploymentFee"],
  ) => void,
): void => {
  const { form, result, reviewPanel, submitButton } = elements;
  const feeFailed = reviewFeeBlocked(review);
  const recipientBlocked = review.flags.some((flag) => flag.code === "address-poisoning");
  setReviewedKey(feeFailed || recipientBlocked ? null : key);
  setRequiresDeployment(review.requiresDeployment);
  // Kept so the send can echo back the exact figure this panel rendered; the
  // background refuses a send whose fee has outrun it (MCW-V09-119).
  setReviewedFees(review.fee, review.deploymentFee);
  form.dataset["stage"] = recipientBlocked ? "blocked" : feeFailed ? "fee-failure" : "review";
  form.removeAttribute("aria-busy");
  if (reviewPanel) {
    renderFragment(reviewPanel, reviewPanelHtml(review));
  }
  submitButton?.lastChild?.replaceWith(
    feeFailed || recipientBlocked ? "Review transfer" : "Confirm transfer",
  );
  if (result) {
    result.textContent = recipientBlocked
      ? "This transfer is blocked. Change the recipient and review it again."
      : feeFailed
        ? "Couldn't estimate the fee. Retry before sending."
        : "Review the details above, then confirm.";
  }
  reviewPanel
    ?.querySelector<HTMLButtonElement>("#review-retry-fee")
    ?.addEventListener("click", () => {
      form.requestSubmit();
    });
  buttonBusy(submitButton, feeFailed);
};

/**
 * Binds the detail screen's send form: the first submit is a read-only review,
 * and only a second submit of the same reviewed fields broadcasts, echoing the
 * reviewed fee so the background can refuse one that has since outrun it. A
 * poisoning flag or a failed fee estimate never unlocks confirmation. The
 * receipt reports the chain's answer; a refusal offers Try again, which
 * reviews afresh rather than reusing the refused fee. Safe to call on every
 * paint; it binds nothing when the form is absent.
 */
export const bindNftSendForm = (deps: NftSendDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#nft-send-form");
  if (!form) {
    return;
  }
  const result = deps.app?.querySelector<HTMLElement>("#nft-send-result");
  const reviewPanel = deps.app?.querySelector<HTMLElement>("#nft-review-panel");
  const recipientInput = form.querySelector<HTMLInputElement>('input[name="recipient"]');
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  let reviewedKey: string | null = null;
  let requiresDeployment = false;
  let reviewedFee: TransferReviewResponse["review"]["fee"] = null;
  let reviewedDeploymentFee: TransferReviewResponse["review"]["deploymentFee"] = null;
  // Bumped by each submission and by leaving its receipt, so a confirmation
  // wait only ever answers for the receipt still on screen.
  let submission = 0;
  form.dataset["stage"] = "recipient";

  // Drops the reviewed transfer, so nothing can confirm its fee again: the
  // next press reviews afresh.
  const forgetReview = (stage: string): void => {
    reviewedKey = null;
    requiresDeployment = false;
    reviewedFee = null;
    reviewedDeploymentFee = null;
    form.dataset["stage"] = stage;
    form.removeAttribute("aria-busy");
  };

  // Back to the recipient: clears any receipt and hands the control back.
  const resetReview = (): void => {
    submission += 1;
    forgetReview("recipient");
    recipientInput?.setCustomValidity("");
    if (reviewPanel) {
      renderFragment(reviewPanel, "");
    }
    submitButton?.lastChild?.replaceWith("Review transfer");
    submitButton?.removeAttribute("hidden");
    buttonBusy(submitButton, false);
  };

  form.addEventListener("input", resetReview);
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-nft-recipient]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!recipientInput) {
        return;
      }
      recipientInput.value = button.dataset["nftRecipient"] ?? "";
      recipientInput.dispatchEvent(new Event("input", { bubbles: true }));
      recipientInput.focus();
    });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const fields = {
      accountId: String(data.get("accountId") ?? ""),
      contract: normalizeFeltInput(String(data.get("contract") ?? "")),
      networkId: String(data.get("networkId") ?? ""),
      recipient: normalizeFeltInput(String(data.get("recipient") ?? "")),
      tokenId: String(data.get("tokenId") ?? ""),
    };
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
      form.dataset["stage"] = "reviewing";
      form.setAttribute("aria-busy", "true");
      if (result) {
        result.textContent = "Checking the transfer…";
      }
      void deps.wallet
        .reviewNftTransfer(fields.contract, fields.tokenId, fields.networkId, fields.recipient)
        .then(
          (review) => {
            renderNftTransferReview(
              { form, result, reviewPanel, submitButton },
              review,
              key,
              (value) => {
                reviewedKey = value;
              },
              (value) => {
                requiresDeployment = value;
              },
              (fee, deploymentFee) => {
                reviewedFee = fee;
                reviewedDeploymentFee = deploymentFee;
              },
            );
          },
          (error: unknown) => {
            const message = friendlyReviewError(error);
            form.dataset["stage"] = "failed";
            form.removeAttribute("aria-busy");
            showToast(message, "error", deps.app);
            if (result) {
              result.textContent = message;
            }
            buttonBusy(submitButton, false);
          },
        );
      return;
    }

    form.dataset["stage"] = "submitting";
    form.setAttribute("aria-busy", "true");
    if (result) {
      result.textContent = "Submitting…";
    }
    void deps.wallet
      .transferNft(
        fields.contract,
        fields.tokenId,
        fields.networkId,
        fields.recipient,
        reviewedFee,
        reviewedDeploymentFee,
      )
      .then(
        async (transactionHash) => {
          const current = ++submission;
          const stillCurrent = (): boolean => form.isConnected && current === submission;
          form.dataset["stage"] = "submitted";
          form.removeAttribute("aria-busy");
          // The receipt's own actions are the way on — Try again included, on
          // a refusal — so the form's control leaves rather than sitting under
          // it disabled, and stays disabled so Enter in the recipient field
          // cannot submit through it.
          if (submitButton) {
            submitButton.disabled = true;
            submitButton.hidden = true;
          }
          if (reviewPanel) {
            renderFragment(reviewPanel, outcomeReceiptSection("nft-success"));
            reviewPanel.querySelector("#nft-success")?.removeAttribute("hidden");
            bindOutcomeReceipt(reviewPanel, "nft-success", {
              activity: () => deps.navigate("activity"),
              home: () => deps.navigate("home"),
              // The same recipient, reviewed afresh: a new fee, then Confirm.
              retry: () => {
                resetReview();
                form.requestSubmit();
              },
            });
          }
          if (result) {
            result.textContent = "";
          }
          // Submitted is not delivered. The receipt opens on what is certain
          // and turns into the transfer or its failure once the chain answers;
          // as in Send and Swap, only that answer is toasted.
          await paintNftReceipt(deps, reviewPanel, null, transactionHash);
          void awaitConfirmation({
            ...(deps.confirmationDelaysMs ? { delaysMs: deps.confirmationDelaysMs } : {}),
            hash: transactionHash,
            loadActivity: () => deps.wallet.loadActivity(),
            stillCurrent,
          }).then(async (outcome) => {
            if (!stillCurrent()) return;
            await paintNftReceipt(deps, reviewPanel, outcome, transactionHash);
            if (!stillCurrent()) return;
            // The chain refused it, so the collectible never moved and the
            // receipt's Try again is the way on. The refused review is dropped
            // rather than kept to confirm again.
            if (outcome?.kind === "failed") forgetReview("failed");
            if (outcome) {
              showToast(
                outcome.toast,
                outcome.kind === "succeeded" ? "success" : "error",
                deps.app,
              );
            }
          });
          if (requiresDeployment) {
            void watchDeployment(
              { render: deps.render, wallet: deps.wallet },
              {
                accountId: fields.accountId,
                stillCurrent: () =>
                  form.isConnected && new FormData(form).get("accountId") === fields.accountId,
              },
            );
          }
        },
        (error: unknown) => {
          const message = errorMessage(error, "The transfer didn't go through");
          form.dataset["stage"] = "failed";
          form.removeAttribute("aria-busy");
          showToast(message, "error", deps.app);
          if (result) {
            result.textContent = `${message} Nothing was submitted; review the recipient and try again.`;
          }
          buttonBusy(submitButton, false);
        },
      );
  });
};
