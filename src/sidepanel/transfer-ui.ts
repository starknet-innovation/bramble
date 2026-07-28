/** Persistent recipient, review, authorization, confirmation, and receipt bindings. */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { buttonBusy, errorMessage, showToast } from "./dom";
import { accountLabel } from "./parts";
import type { SidepanelWallet } from "./runtime";
import { transitionSendStage } from "./send-transition";
import { watchDeployment } from "./shell-bindings";
import { tokenGlyph } from "./token-row";
import { bindTransferCompose, restoreTransferCompose, sendFormInput } from "./transfer-compose-ui";
import {
  confirmationStatus,
  friendlyReviewError,
  initialTransferState,
  recipientFieldError,
  type TransferFields,
  type TransferStage,
  type TransferState,
  transferFields,
  transferKey,
  transferStageTitle,
} from "./transfer-model";
import { reviewPanelHtml } from "./transfer-review-markup";

export { activityExportToast, bindActivity } from "./activity-ui";
export { friendlyReviewError, recipientFieldError } from "./transfer-model";
export { reviewPanelHtml } from "./transfer-review-markup";

type Review = Awaited<ReturnType<SidepanelWallet["reviewTransfer"]>>;

/**
 * Dependencies the Send binding closes over. Confirmation timing is injected
 * so tests and the UI Lab never wait on wall-clock delays.
 */
export type TransferUiDeps = {
  readonly app: Element | null;
  readonly back?: () => void;
  readonly confirmationDelaysMs?: readonly number[];
  readonly navigate?: (view: "activity" | "home") => void;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly waitForConfirmation?: (delayMs: number) => Promise<void>;
  readonly wallet: SidepanelWallet;
};

let transferState: TransferState<Review> = initialTransferState();
let transferEpoch = 0;
let repaintActiveTransfer: (() => void) | null = null;
let transferApp: Element | null = null;

const setText = (root: ParentNode, id: string, text: string): void => {
  const node = root.querySelector(`#${id}`);
  if (node) {
    node.textContent = text;
  }
};

const setSendProgress = (form: HTMLFormElement, stage: TransferStage): void => {
  const progress = form.querySelector<HTMLElement>(".send-progress");
  progress?.toggleAttribute("hidden", stage === "recipient" || stage === "asset");
  const activeIndex =
    stage === "details"
      ? 0
      : stage === "review" || stage === "reviewing"
        ? 1
        : stage === "submitted"
          ? 3
          : stage === "confirming" || stage === "pending"
            ? 3
            : 2;
  form.querySelectorAll<HTMLElement>("[data-send-step]").forEach((step, index) => {
    const currentStep = step;
    currentStep.dataset["state"] =
      index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
    currentStep.toggleAttribute("aria-current", index === activeIndex);
  });
};

const restoreTransferFields = (form: HTMLFormElement, fields: TransferFields | null): void => {
  if (!fields) {
    return;
  }
  const values: Readonly<Record<string, string>> = {
    accountId: fields.accountId,
    amount: fields.amount,
    fiatEstimate: fields.fiatEstimate,
    recipient: fields.recipient,
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

const reviewSummaryHtml = (fields: TransferFields): string => `
  <div class="send-review-hero">
    <span class="send-review-token">${tokenGlyph(fields.tokenAddress, fields.tokenSymbol)}</span>
    <span><strong>${escapeHtml(fields.amount)} ${escapeHtml(fields.tokenSymbol)}</strong><small>${escapeHtml(fields.fiatEstimate || "Fiat estimate unavailable")}</small></span>
  </div>
  <dl class="send-review-facts">
    <div><dt>Recipient</dt><dd><strong>${escapeHtml(fields.recipientLabel || accountLabel(fields.recipient))}</strong><code>${escapeHtml(accountLabel(fields.recipient))}</code></dd></div>
    <div><dt>Speed</dt><dd><strong>${fields.speed === "fast" ? "Fast" : "Standard"}</strong></dd></div>
  </dl>`;

type WorkingStatus = {
  readonly copy: string;
  readonly labels: readonly [string, string, string, string];
  readonly liveness: string;
  readonly states: readonly [
    "active" | "done" | "pending",
    "active" | "done" | "pending",
    "active" | "done" | "pending",
    "active" | "done" | "pending",
  ];
  readonly title: string;
};

const workingStatus = (state: TransferState<Review>): WorkingStatus => {
  if (state.stage === "reviewing") {
    return {
      copy: "Validating the recipient, decoding the exact call, and estimating the fee.",
      labels: ["Validate details", "Authorize", "Broadcast", "Confirm on Starknet"],
      liveness: "This normally takes less than a second.",
      states: ["active", "pending", "pending", "pending"],
      title: "Preparing a safe review",
    };
  }
  if (state.stage === "broadcasting") {
    return {
      copy: "Device approval passed verification. The locked transaction is being broadcast.",
      labels: ["Review locked", "Device verified", "Broadcast to Starknet", "Confirm on Starknet"],
      liveness: "Do not disconnect the device until broadcast completes.",
      states: ["done", "done", "active", "pending"],
      title: "Sending to Starknet",
    };
  }
  if (state.stage === "confirming") {
    return {
      copy: "Starknet received the transaction. MC Wallet is checking its chain status now.",
      labels: ["Review locked", "Authorized", "Broadcast complete", "Confirm on Starknet"],
      liveness: "Fast confirmations often arrive in under a second.",
      states: ["done", "done", "done", "active"],
      title: "Confirming on Starknet",
    };
  }
  const ledger = state.fields?.signer === "ledger";
  return {
    copy: ledger
      ? "Review the request on your Ledger. Nothing broadcasts until device approval is verified."
      : "The reviewed transaction is being authorized inside the wallet.",
    labels: [
      "Review locked",
      ledger ? "Approve on Ledger" : "Sign securely",
      "Broadcast to Starknet",
      "Confirm on Starknet",
    ],
    liveness: ledger ? "The wallet is waiting for the device." : "Keep this panel open.",
    states: ["done", "active", "pending", "pending"],
    title: ledger ? "Waiting for your Ledger" : "Authorizing transaction",
  };
};

const setTaskStatus = (
  form: HTMLFormElement,
  task: "authorize" | "broadcast" | "confirm" | "review",
  label: string,
  state: "active" | "done" | "pending",
): void => {
  const row = form.querySelector<HTMLElement>(`[data-send-task="${task}"]`);
  if (row) {
    row.dataset["state"] = state;
  }
  setText(form, `send-task-${task}-label`, label);
};

const applyTransferUi = (form: HTMLFormElement): void => {
  const currentForm = form;
  const state = transferState;
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

  const reviewPanel = form.querySelector<HTMLElement>("#review-panel");
  if (reviewPanel) {
    reviewPanel.innerHTML = state.review ? reviewPanelHtml(state.review) : "";
  }
  const reviewSummary = form.querySelector<HTMLElement>("#send-review-summary");
  if (reviewSummary) {
    reviewSummary.innerHTML = state.fields ? reviewSummaryHtml(state.fields) : "";
  }
  reviewPanel
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

/**
 * Advances an in-wallet Ledger send from device authorization to network
 * broadcast after verified approval; unrelated or inactive requests are ignored.
 */
export const markTransferLedgerAuthorized = (): void => {
  if (transferState.stage !== "authorizing" || transferState.fields?.signer !== "ledger") return;
  transferState = { ...transferState, stage: "broadcasting" };
  repaintActiveTransfer?.();
};

/**
 * Binds the recipient-first Send journey and observes the submitted hash until
 * Starknet reports acceptance, rejection, reversion, or a bounded pending state.
 */
export const bindTransfer = (deps: TransferUiDeps): void => {
  const { app, back, navigate, render, wallet } = deps;
  const form = app?.querySelector<HTMLFormElement>("#transfer-form");
  if (!form) {
    transferEpoch += 1;
    transferState = initialTransferState();
    repaintActiveTransfer = null;
    transferApp = app;
    return;
  }
  if (transferApp !== app) {
    transferEpoch += 1;
    transferState = initialTransferState();
    transferApp = app;
  }
  const accountId = sendFormInput(form, "accountId")?.value ?? "";
  if (transferState.fields && transferState.fields.accountId !== accountId) {
    transferEpoch += 1;
    transferState = initialTransferState();
  }
  const repaint = (): void =>
    transitionSendStage(form.ownerDocument, form.dataset["stage"], transferState.stage, () =>
      applyTransferUi(form),
    );
  repaintActiveTransfer = repaint;
  repaint();
  const goTo = (stage: TransferStage): void => {
    transferState = { ...transferState, fields: transferFields(form), stage };
    repaint();
  };
  const exit = (): void => (back ? back() : navigate?.("home"));
  form.ownerDocument.querySelector("#send-close")?.addEventListener("click", exit);
  form.ownerDocument.querySelector("#send-header-back")?.addEventListener("click", () => {
    if (transferState.stage === "asset") goTo("details");
    else if (transferState.stage === "details") goTo("recipient");
    else if (transferState.stage === "review") goTo("details");
    else exit();
  });
  bindTransferCompose({
    form,
    goTo,
    onFields: (fields) => {
      transferState = { ...transferState, fields };
    },
  });

  const editDetails = (): void => {
    transferEpoch += 1;
    transferState = {
      ...transferState,
      error: "",
      review: null,
      reviewedKey: null,
      stage: "details",
    };
    repaint();
    form.querySelector<HTMLInputElement>("#send-amount-input")?.focus();
  };
  form.querySelector("#send-edit")?.addEventListener("click", editDetails);
  form.querySelector("#send-failure-edit")?.addEventListener("click", editDetails);
  form.querySelector("#send-another")?.addEventListener("click", () => {
    transferEpoch += 1;
    form.reset();
    transferState = initialTransferState();
    repaint();
    form.querySelector<HTMLInputElement>("#send-recipient-search")?.focus();
  });
  form
    .querySelector("#send-view-activity")
    ?.addEventListener("click", () => navigate?.("activity"));
  form
    .querySelector("#send-pending-activity")
    ?.addEventListener("click", () => navigate?.("activity"));

  const wait =
    deps.waitForConfirmation ??
    ((delayMs: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      }));
  const confirmSubmitted = async (epoch: number): Promise<void> => {
    const hash = transferState.transactionHash;
    if (!hash) return;
    for (const delay of deps.confirmationDelaysMs ?? [0, 250, 500, 900, 1_500, 2_500, 4_000]) {
      await wait(delay);
      if (epoch !== transferEpoch) return;
      try {
        const activity = await wallet.loadActivity();
        if (epoch !== transferEpoch) return;
        const status = confirmationStatus(activity.entries, hash);
        if (status === "accepted") {
          transferState = { ...transferState, error: "", stage: "submitted" };
          repaintActiveTransfer?.();
          showToast("Transaction confirmed on Starknet", "success");
          return;
        }
        if (status === "rejected" || status === "reverted") {
          transferState = {
            ...transferState,
            error:
              status === "reverted"
                ? "Starknet reverted this transaction. Review its activity details before retrying."
                : "Starknet rejected this transaction. No transfer was completed.",
            stage: "failed",
          };
          repaintActiveTransfer?.();
          showToast("Transaction was not confirmed", "error");
          return;
        }
      } catch {
        // A transient activity read is retried at the next scheduled checkpoint.
      }
    }
    if (epoch === transferEpoch) {
      transferState = { ...transferState, stage: "pending" };
      repaintActiveTransfer?.();
    }
  };
  form.querySelector("#send-check-again")?.addEventListener("click", () => {
    const epoch = ++transferEpoch;
    transferState = { ...transferState, stage: "confirming" };
    repaint();
    void confirmSubmitted(epoch);
  });
  form.querySelector("#send-retry")?.addEventListener("click", () => {
    transferState = { ...transferState, error: "", stage: "review" };
    repaint();
    form.requestSubmit();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const fields = transferFields(form);
    const recipientError = recipientFieldError(fields.recipient);
    const visibleAmount = form.querySelector<HTMLInputElement>("#send-amount-input");
    if (recipientError) {
      transferState = { ...transferState, error: recipientError, fields, stage: "recipient" };
      repaint();
      form.querySelector<HTMLInputElement>("#send-recipient-search")?.focus();
      return;
    }
    if (!fields.amount || !Number.isFinite(Number(fields.amount)) || Number(fields.amount) <= 0) {
      visibleAmount?.setCustomValidity("Enter an amount greater than zero.");
      visibleAmount?.reportValidity();
      transferState = {
        ...transferState,
        error: "Enter an amount greater than zero.",
        fields,
        stage: "details",
      };
      repaint();
      return;
    }
    const key = transferKey(fields);
    if (transferState.reviewedKey !== key) {
      const epoch = ++transferEpoch;
      transferState = { ...initialTransferState<Review>(), fields, stage: "reviewing" };
      repaint();
      void wallet
        .reviewTransfer(fields.accountId, fields.tokenId, fields.recipient, fields.amount)
        .then(
          (review) => {
            if (epoch !== transferEpoch) return;
            const feeFailed = review.feeEstimateFailed;
            transferState = {
              error: feeFailed
                ? "Fee estimate unavailable. Retry before authorizing this transaction."
                : "",
              fields,
              requiresDeployment: review.requiresDeployment,
              review,
              reviewedKey: feeFailed ? null : key,
              stage: "review",
              transactionHash: null,
            };
            repaintActiveTransfer?.();
          },
          (error: unknown) => {
            if (epoch !== transferEpoch) return;
            const message = friendlyReviewError(error);
            showToast(message, "error");
            transferState = { ...initialTransferState(), error: message, fields, stage: "details" };
            repaintActiveTransfer?.();
          },
        );
      return;
    }
    const epoch = ++transferEpoch;
    const requiresDeployment = transferState.requiresDeployment;
    transferState = { ...transferState, error: "", fields, stage: "authorizing" };
    repaint();
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
          if (epoch !== transferEpoch) return;
          transferState = { ...transferState, stage: "confirming", transactionHash };
          repaintActiveTransfer?.();
          if (requiresDeployment) void watchDeployment({ render, wallet });
          void confirmSubmitted(epoch);
        },
        (error: unknown) => {
          if (epoch !== transferEpoch) return;
          const message = errorMessage(error, "Transfer failed");
          transferState = {
            ...transferState,
            error: `The transaction was not sent. ${message}`,
            stage: "failed",
          };
          repaintActiveTransfer?.();
          showToast("Transaction was not sent", "error");
        },
      );
  });
};
