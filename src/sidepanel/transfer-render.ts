/**
 * Send-screen rendering: stage visibility, restored field values, the review
 * panels, and the receipt text. Split from ./transfer-ui to keep both under the
 * size budget; every write is a function of the state passed in, with no wallet
 * access and no state of its own.
 */

import { buttonBusy } from "./dom";
import { accountLabel } from "./parts";
import { restoreTransferCompose, sendFormInput } from "./transfer-compose-ui";
import type { TransferFields, TransferStage, TransferState } from "./transfer-model";
import { transferStageTitle } from "./transfer-model";
import { setSendProgress, setTaskStatus, setText, workingStatus } from "./transfer-progress-ui";
import { reviewDetailsHtml, reviewSummaryHtml } from "./transfer-review-markup";
import { routeDisclosureHtml, routeFeeHtml } from "./transfer-review-routes";
import { transferRoute } from "./transfer-route";
import type { TransferReview } from "./transfer-submit";

const restoreTransferFields = (form: HTMLFormElement, fields: TransferFields | null): void => {
  if (!fields) {
    return;
  }
  const values: Readonly<Record<string, string>> = {
    accountId: fields.accountId,
    amount: fields.amount,
    destination: fields.destination,
    fiatEstimate: fields.fiatEstimate,
    recipient: fields.recipient,
    source: fields.source,
    recipientLabel: fields.recipientLabel,
    speed: fields.speed,
    tokenAddress: fields.tokenAddress,
    tokenBalance: fields.tokenBalance,
    tokenDecimals: fields.tokenDecimals,
    tokenFormatted: fields.tokenFormatted,
    tokenId: fields.tokenId,
    tokenPrice: fields.tokenPrice,
    tokenSymbol: fields.tokenSymbol,
  };
  for (const [name, value] of Object.entries(values)) {
    const control = sendFormInput(form, name);
    if (control && control !== control.ownerDocument.activeElement) {
      control.value = value;
    }
  }
  restoreTransferCompose(form, fields);
};

/**
 * Paints the Send form for one state. `poolFeeFri` is threaded in rather than
 * read here: the privacy reading belongs to the binding, so this stays a
 * function of its inputs.
 */
export const applyTransferUi = (
  form: HTMLFormElement,
  state: TransferState<TransferReview>,
  poolFeeFri?: string,
): void => {
  const currentForm = form;
  const previousStage = currentForm.dataset["stage"];
  const working = ["authorizing", "broadcasting", "confirming", "reviewing"].includes(state.stage);
  currentForm.dataset["stage"] = state.stage;
  currentForm.toggleAttribute("aria-busy", working);
  const stageIds: Readonly<Record<string, TransferStage>> = {
    "send-asset-stage": "asset",
    "send-details": "details",
    "send-failure": "failed",
    "send-pending": "pending",
    "send-recipient-stage": "recipient",
    "send-review-stage": "review",
    "send-success": "submitted",
  };
  for (const [id, stage] of Object.entries(stageIds)) {
    form.querySelector(`#${id}`)?.toggleAttribute("hidden", state.stage !== stage);
  }
  form.querySelector("#send-working")?.toggleAttribute("hidden", !working);
  setText(form.ownerDocument, "send-header-title", transferStageTitle(state.stage));
  setSendProgress(form, state.stage);
  restoreTransferFields(form, state.fields);

  const confirmButton = form.querySelector<HTMLButtonElement>("#send-confirm-button");
  buttonBusy(confirmButton, state.stage === "authorizing");
  if (confirmButton && state.stage === "review") {
    confirmButton.disabled = state.review?.feeEstimateFailed === true;
  }
  setText(
    form,
    "send-confirm-label",
    state.fields?.signer === "ledger" ? "Approve with Ledger" : "Confirm and send",
  );

  const route = state.fields ? transferRoute(state.fields) : null;
  const reviewPanel = form.querySelector<HTMLElement>("#review-panel");
  if (reviewPanel) {
    // The disclosure leads: what a route publishes matters more than its decoded
    // calls, and it is the one thing the four routes genuinely differ on.
    reviewPanel.innerHTML = state.review
      ? `${route ? routeDisclosureHtml(route) : ""}${reviewDetailsHtml(state.review)}`
      : "";
  }
  const reviewFee = form.querySelector<HTMLElement>("#send-review-fee");
  if (reviewFee && route) {
    reviewFee.innerHTML = routeFeeHtml(route, {
      ...(poolFeeFri === undefined ? {} : { poolFeeFri }),
      preparation: state.privatePreparation,
      review: state.review,
    });
  }
  const reviewSummary = form.querySelector<HTMLElement>("#send-review-summary");
  if (reviewSummary) {
    reviewSummary.innerHTML = state.fields ? reviewSummaryHtml(state.fields) : "";
  }
  reviewFee
    ?.querySelector<HTMLButtonElement>("#review-retry-fee")
    ?.addEventListener("click", () => form.requestSubmit());

  if (working) {
    const status = workingStatus(state);
    setText(form, "send-working-title", status.title);
    setText(form, "send-working-copy", status.copy);
    setText(form, "send-liveness", status.liveness);
    setTaskStatus(form, "review", status.labels[0], status.states[0]);
    setTaskStatus(form, "authorize", status.labels[1], status.states[1]);
    setTaskStatus(form, "broadcast", status.labels[2], status.states[2]);
    setTaskStatus(form, "confirm", status.labels[3], status.states[3]);
  }
  if (state.fields && state.transactionHash) {
    const summary = `${state.fields.amount} ${state.fields.tokenSymbol} sent to ${state.fields.recipientLabel || accountLabel(state.fields.recipient)}`;
    setText(form, "send-success-summary", summary);
    setText(form, "send-success-hash", state.transactionHash);
    setText(form, "send-pending-hash", state.transactionHash);
    setText(form, "send-failure-hash", state.transactionHash);
  }
  if (state.stage === "failed") {
    setText(
      form,
      "send-failure-copy",
      state.error || "The transaction was not sent. Your balance is unchanged.",
    );
  }
  setText(form, "transfer-result", state.stage === "failed" ? "" : state.error);
  if (previousStage && previousStage !== state.stage) {
    form.ownerDocument.documentElement.scrollTop = 0;
    form.ownerDocument.body.scrollTop = 0;
  }
};
