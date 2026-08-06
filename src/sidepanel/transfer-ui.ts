/** Persistent recipient, review, authorization, confirmation, and receipt bindings. */
import type { WalletStatus } from "../popup/responses";
import { buttonBusy, errorMessage, showToast } from "./dom";
import { accountLabel } from "./parts";
import type { PrivacyDisclosureState } from "./privacy-model";
import type { SidepanelWallet } from "./runtime";
import { transitionSendStage } from "./send-transition";
import { watchDeployment } from "./shell-bindings";
import { bindTransferCompose, restoreTransferCompose, sendFormInput } from "./transfer-compose-ui";
import type { TransferState } from "./transfer-model";
import {
  CONFIRMATION_DELAYS_MS,
  confirmationOutcome,
  confirmationStatus,
  friendlyReviewError,
  initialTransferState,
  recipientFieldError,
  type TransferFields,
  type TransferStage,
  transferFields,
  transferKey,
  transferStageTitle,
} from "./transfer-model";
import { bindPrivateSendToggle } from "./transfer-private-ui";
import { setSendProgress, setTaskStatus, setText, workingStatus } from "./transfer-progress-ui";
import {
  privateRelayFeeHtml,
  reviewDetailsHtml,
  reviewFeeHtml,
  reviewSummaryHtml,
} from "./transfer-review-markup";

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
  /** Invalidates the cached private balance once a private send is accepted. */
  readonly onPrivateSendSettled?: () => void;
  readonly privacy?: () => PrivacyDisclosureState;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly waitForConfirmation?: (delayMs: number) => Promise<void>;
  readonly wallet: SidepanelWallet;
};

let transferState: TransferState<Review> = initialTransferState();
let transferEpoch = 0;
let repaintActiveTransfer: (() => void) | null = null;
let transferApp: Element | null = null;

const restoreTransferFields = (form: HTMLFormElement, fields: TransferFields | null): void => {
  if (!fields) {
    return;
  }
  const values: Readonly<Record<string, string>> = {
    accountId: fields.accountId,
    amount: fields.amount,
    fiatEstimate: fields.fiatEstimate,
    privateSend: fields.privateSend,
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

// `poolFeeFri` is threaded in, not read here: the privacy reading belongs to the
// binding, so this stays a function of its inputs.
const applyTransferUi = (form: HTMLFormElement, poolFeeFri?: string): void => {
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
    reviewPanel.innerHTML = state.review ? reviewDetailsHtml(state.review) : "";
  }
  const reviewFee = form.querySelector<HTMLElement>("#send-review-fee");
  if (reviewFee) {
    reviewFee.innerHTML = state.privatePreparation?.relayFee
      ? privateRelayFeeHtml(state.privatePreparation.relayFee, poolFeeFri)
      : state.review
        ? reviewFeeHtml(state.review)
        : "";
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
 * Starknet reports a pre-confirmation, acceptance, rejection, reversion, or a
 * bounded pending state. A pre-confirmation completes the journey; the
 * background monitor keeps verifying the transaction after the panel closes.
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
      applyTransferUi(form, deps.privacy?.().value?.poolFeeFri),
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
  if (deps.privacy) {
    bindPrivateSendToggle({
      form,
      onModeChange: () => {
        transferState = {
          ...transferState,
          fields: transferFields(form),
          privatePreparation: null,
          review: null,
          reviewedKey: null,
        };
      },
      privacy: deps.privacy,
      wallet,
    });
  }

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
  // Polls to CONFIRMATION_DELAYS_MS, then hands over to "Check again".
  const confirmSubmitted = async (epoch: number): Promise<void> => {
    const hash = transferState.transactionHash;
    if (!hash) return;
    for (const delay of deps.confirmationDelaysMs ?? CONFIRMATION_DELAYS_MS) {
      await wait(delay);
      if (epoch !== transferEpoch) return;
      try {
        const activity = await wallet.loadActivity();
        if (epoch !== transferEpoch) return;
        const outcome = confirmationOutcome(confirmationStatus(activity.entries, hash));
        if (outcome) {
          transferState =
            outcome.kind === "succeeded"
              ? { ...transferState, error: "", stage: "submitted" }
              : { ...transferState, error: outcome.message, stage: "failed" };
          repaintActiveTransfer?.();
          showToast(outcome.toast, outcome.kind === "succeeded" ? "success" : "error");
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
      if (fields.privateSend === "1") {
        void wallet.preparePrivacyTransfer(fields.tokenId, fields.recipient, fields.amount).then(
          (preparation) => {
            if (epoch !== transferEpoch) return;
            transferState = {
              error: "",
              fields,
              privatePreparation: preparation,
              requiresDeployment: false,
              review: {
                fee: null,
                // The relay pays the network fee and recovers the pool's charge
                // from the shielded balance, so the public STRK affordability
                // guard has nothing to say here; "unknown" renders no notice.
                feeAffordability: "unknown",
                feeEstimateFailed: false,
                flags: [],
                requiresDeployment: false,
                summaries: [...preparation.summaries],
              } as Review,
              reviewedKey: key,
              stage: "review",
              transactionHash: null,
            };
            repaintActiveTransfer?.();
          },
          (error: unknown) => {
            if (epoch !== transferEpoch) return;
            const message = errorMessage(error, "Private send preparation failed");
            showToast(message, "error");
            transferState = { ...initialTransferState(), error: message, fields, stage: "details" };
            repaintActiveTransfer?.();
          },
        );
        return;
      }
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
              privatePreparation: null,
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
    const privatePreparation = transferState.privatePreparation;
    transferState = { ...transferState, error: "", fields, stage: "authorizing" };
    repaint();
    if (fields.privateSend === "1") {
      if (!privatePreparation) {
        transferState = {
          ...transferState,
          error: "Review the private send first",
          stage: "details",
        };
        repaint();
        return;
      }
      void wallet.executePrivacyPreparation(privatePreparation.id).then(
        (transactionHash) => {
          if (epoch !== transferEpoch) return;
          transferState = {
            ...transferState,
            privatePreparation: null,
            reviewedKey: null,
            stage: "confirming",
            transactionHash,
          };
          deps.onPrivateSendSettled?.();
          repaintActiveTransfer?.();
          void confirmSubmitted(epoch);
        },
        (error: unknown) => {
          if (epoch !== transferEpoch) return;
          const message = errorMessage(error, "Private send failed");
          transferState = {
            ...transferState,
            error: `The transaction was not sent. ${message}`,
            privatePreparation: null,
            reviewedKey: null,
            stage: "failed",
          };
          repaintActiveTransfer?.();
          showToast("Transaction was not sent", "error");
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
