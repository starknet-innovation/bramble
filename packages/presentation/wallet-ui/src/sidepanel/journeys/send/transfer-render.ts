/**
 * Send-screen rendering: stage visibility, restored field values, the review
 * panels, and the receipt text. Split from ./transfer-ui to keep both under the
 * size budget; every write is a function of the state passed in, with no wallet
 * access and no state of its own.
 */

import { bindCopyButtons, buttonBusy } from "../../shared/dom";
import { accountLabel } from "../../shared/parts";
import { reviewFeeBlocked } from "../../shared/review-render";
import { restoreTransferCompose, sendFormInput } from "./transfer-compose-ui";
import {
  type TransferMode,
  transferModeCopy,
  transferModeFor,
  transferStageTitle,
  transferSuccessSummary,
} from "./transfer-mode";
import type { TransferFields, TransferStage, TransferState } from "./transfer-model";
import {
  setSendProgress,
  setTaskStatus,
  setText,
  type WorkingStatus,
  workingStatus,
} from "./transfer-progress-ui";
import { reviewRisksHtml, reviewSummaryHtml } from "./transfer-review-markup";
import { routeReviewFeeHtml } from "./transfer-review-routes";
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

// The sender travels on the form rather than through another parameter: the
// template that rendered it knew the account, and the mode is a function of
// those fields plus that one address, so this stays a pure paint.
const modeOf = (form: HTMLFormElement, fields: TransferFields | null): TransferMode =>
  fields ? transferModeFor(fields, form.dataset["sender"] ?? "") : "send";

const WORKING_STAGES: ReadonlySet<TransferStage> = new Set([
  "authorizing",
  "broadcasting",
  "confirming",
]);

// A pool route's review is a proof or a relay quote, tens of seconds to over a
// minute, so its wait takes the working screen like a broadcast does. A public
// review is a fee estimate: the amount step stays in view with its button busy.
const isPreparing = <Review>(state: TransferState<Review>): boolean =>
  state.stage === "reviewing" &&
  state.fields !== null &&
  transferRoute(state.fields).id !== "public-public";

// Locks the amount step while its review is being prepared, so the fields a
// preparation was started from cannot change under it and a second submit is
// impossible. Only controls this lock disabled are re-enabled: one the template
// disabled for its own reason (no asset to choose) keeps that reason.
const lockCompose = (form: HTMLFormElement, locked: boolean): void => {
  for (const control of form.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
    "#send-details button, #send-details input",
  )) {
    if (control.id === "send-review-button") continue;
    if (locked && !control.disabled) {
      control.disabled = true;
      control.toggleAttribute("data-send-locked", true);
    } else if (!locked && control.hasAttribute("data-send-locked")) {
      control.disabled = false;
      control.removeAttribute("data-send-locked");
    }
  }
};

// Every string that names the operation, rewritten on each paint so the header,
// the actions, and the receipts follow a bucket flip together. The review
// button names the wait while it runs, and its own action otherwise.
const applyModeCopy = (form: HTMLFormElement, mode: TransferMode, reviewing: boolean): void => {
  const copy = transferModeCopy(mode);
  const doc = form.ownerDocument;
  doc.querySelector("#send-close")?.setAttribute("aria-label", copy.closeLabel);
  doc.querySelector("#send-close")?.setAttribute("title", copy.closeLabel);
  form.querySelector(".send-progress")?.setAttribute("aria-label", copy.progressLabel);
  form.querySelector("#send-amount-input")?.setAttribute("aria-label", copy.amountLabel);
  setText(form, "send-amount-label", copy.amountLabel);
  setText(form, "send-review-label", reviewing ? `${copy.preparing}…` : copy.reviewLabel);
  setText(form, "send-success-title", copy.successTitle);
  setText(form, "send-failure-title", copy.failureTitle);
};

/**
 * Rewrites only the working screen's liveness line for a progress poll, so a
 * job that reports every second and a half does not repaint the whole form.
 * The full repaint renders the same line from the same state.
 */
export const applyTransferProgress = <Review>(
  form: HTMLFormElement,
  state: TransferState<Review>,
): void => {
  applyWorkingStatus(form, workingStatus(state, modeOf(form, state.fields)));
};

// Paints the working screen — title, copy, liveness, and the four task rows —
// from one status, so a job's progress poll and a full repaint agree.
const applyWorkingStatus = (form: HTMLFormElement, status: WorkingStatus): void => {
  setText(form, "send-working-title", status.title);
  setText(form, "send-working-copy", status.copy);
  setText(form, "send-liveness", status.liveness);
  setTaskStatus(form, "review", status.labels[0], status.states[0]);
  setTaskStatus(form, "authorize", status.labels[1], status.states[1]);
  setTaskStatus(form, "broadcast", status.labels[2], status.states[2]);
  setTaskStatus(form, "confirm", status.labels[3], status.states[3]);
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
  const reviewing = state.stage === "reviewing";
  const preparing = isPreparing(state);
  const working = WORKING_STAGES.has(state.stage) || preparing;
  // A preparing pool route shows no stage section at all: the working screen
  // is the stage until the review lands or the preparation is abandoned.
  const visibleStage: TransferStage | null = reviewing
    ? preparing
      ? null
      : "details"
    : state.stage;
  currentForm.dataset["stage"] = state.stage;
  currentForm.toggleAttribute("aria-busy", working);
  const stageIds: Readonly<Record<string, TransferStage>> = {
    "send-details": "details",
    "send-failure": "failed",
    "send-pending": "pending",
    "send-recipient-stage": "recipient",
    "send-review-stage": "review",
    "send-success": "submitted",
  };
  for (const [id, stage] of Object.entries(stageIds)) {
    form.querySelector(`#${id}`)?.toggleAttribute("hidden", visibleStage !== stage);
  }
  form.querySelector("#send-working")?.toggleAttribute("hidden", !working);
  const mode = modeOf(form, state.fields);
  setText(form.ownerDocument, "send-header-title", transferStageTitle(state.stage, mode));
  if (state.fields) applyModeCopy(form, mode, reviewing);
  setSendProgress(form, state.stage);
  restoreTransferFields(form, state.fields);

  const confirmButton = form.querySelector<HTMLButtonElement>("#send-confirm-button");
  lockCompose(form, reviewing);
  buttonBusy(form.querySelector<HTMLButtonElement>("#send-review-button"), reviewing);
  buttonBusy(confirmButton, state.stage === "authorizing");
  if (confirmButton && state.stage === "review") {
    confirmButton.disabled = state.review != null && reviewFeeBlocked(state.review);
  }
  setText(
    form,
    "send-confirm-label",
    state.fields?.signer === "ledger" ? "Approve with Ledger" : transferModeCopy(mode).confirmLabel,
  );

  const route = state.fields ? transferRoute(state.fields) : null;
  // Only real warnings reach the confirm face. There is no "nothing was
  // detected" line and no decoded-call list: a quiet transfer shows nothing
  // here, and a flagged one can no longer hide behind a collapsed disclosure.
  const reviewRisks = form.querySelector<HTMLElement>("#send-review-risks");
  if (reviewRisks) {
    const risks = state.review ? reviewRisksHtml(state.review) : "";
    reviewRisks.innerHTML = risks;
    reviewRisks.toggleAttribute("hidden", risks === "");
  }
  const reviewFee = form.querySelector<HTMLElement>("#send-review-fee");
  if (reviewFee && route) {
    // Fee lines and the disclosure together, directly under the estimate: what
    // the move costs and what it exposes are one decision.
    reviewFee.innerHTML = routeReviewFeeHtml(route, {
      ...(poolFeeFri === undefined ? {} : { poolFeeFri }),
      preparation: state.privatePreparation,
      review: state.review,
    });
  }
  const reviewSummary = form.querySelector<HTMLElement>("#send-review-summary");
  if (reviewSummary) {
    reviewSummary.innerHTML = state.fields
      ? reviewSummaryHtml(state.fields, mode, {
          address: form.dataset["sender"] ?? "",
          label: form.dataset["senderLabel"] ?? "",
        })
      : "";
    // Freshly rendered markup: the shell's copy binding ran before this paint.
    bindCopyButtons(reviewSummary);
  }
  reviewFee
    ?.querySelector<HTMLButtonElement>("#review-retry-fee")
    ?.addEventListener("click", () => form.requestSubmit());

  if (working) {
    applyWorkingStatus(form, workingStatus(state, mode));
  }
  // While a private send is preparing, the screen is the title alone: the task
  // list and the standing hint belong to a transaction that has been submitted.
  form.querySelector(".send-task-list")?.toggleAttribute("hidden", preparing);
  form.querySelector("#send-working-copy")?.toggleAttribute("hidden", preparing);
  form.querySelector("#send-liveness")?.toggleAttribute("hidden", preparing);
  if (state.fields && state.transactionHash) {
    const summary = transferSuccessSummary(
      mode,
      state.fields.amount,
      state.fields.tokenSymbol,
      state.fields.recipientLabel || accountLabel(state.fields.recipient),
    );
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
