/** Persistent Send review, authorization, broadcast, and receipt bindings. */
import type { WalletStatus } from "../popup/responses";
import { isStarkFieldElement, normalizeFeltInput } from "../starknet/networks";
import { receiptRows } from "../ui/content";
import { buttonBusy, errorMessage, showToast } from "./dom";
import { accountLabel } from "./parts";
import type { SidepanelWallet } from "./runtime";
import { transitionSendStage } from "./send-transition";
import { watchDeployment } from "./shell-bindings";
import { reviewPanelHtml } from "./transfer-review-markup";

export { activityExportToast, bindActivity } from "./activity-ui";
export { reviewPanelHtml } from "./transfer-review-markup";

const INVALID_RECIPIENT_MESSAGE = "Enter a valid Starknet address.";

const INVALID_REVIEW_ERRORS = new Set([
  "invalid nft transfer review request",
  "invalid transfer review request",
]);

/**
 * Returns an inline error for a malformed Starknet address. Normalization keeps
 * the check aligned with the background and accepts mixed-case hex.
 */
export const recipientFieldError = (recipient: string): string | null =>
  isStarkFieldElement(normalizeFeltInput(recipient)) ? null : INVALID_RECIPIENT_MESSAGE;

/**
 * Maps the background's developer error string for a malformed recipient onto
 * the same friendly, inline message; passes every other error through.
 */
export const friendlyReviewError = (error: unknown): string => {
  const message = errorMessage(error, "Transfer review failed");
  return INVALID_REVIEW_ERRORS.has(message) ? INVALID_RECIPIENT_MESSAGE : message;
};

/**
 * Dependencies the transfer binding closes over.
 */
export type TransferUiDeps = {
  readonly app: Element | null;
  readonly navigate?: (view: "activity" | "home") => void;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly wallet: SidepanelWallet;
};

type TransferFields = {
  readonly accountId: string;
  readonly amount: string;
  readonly recipient: string;
  readonly signer: "ledger" | "software";
  readonly speed: "fast" | "standard";
  readonly tokenId: string;
  readonly tokenSymbol: string;
};

const transferFields = (form: HTMLFormElement): TransferFields => {
  const data = new FormData(form);
  const tokenSelect = form.querySelector<HTMLSelectElement>('select[name="tokenId"]');
  return {
    accountId: String(data.get("accountId") ?? ""),
    amount: String(data.get("amount") ?? "").trim(),
    recipient: normalizeFeltInput(String(data.get("recipient") ?? "")),
    signer: form.dataset["signer"] === "ledger" ? "ledger" : "software",
    speed: data.get("speed") === "fast" ? ("fast" as const) : ("standard" as const),
    tokenId: String(data.get("tokenId") ?? ""),
    tokenSymbol: tokenSelect?.selectedOptions[0]?.dataset["symbol"] ?? "token",
  };
};

type Review = Awaited<ReturnType<SidepanelWallet["reviewTransfer"]>>;

type TransferStage =
  | "authorizing"
  | "broadcasting"
  | "details"
  | "review"
  | "reviewing"
  | "submitted";

type TransferState = {
  readonly error: string;
  readonly fields: TransferFields | null;
  readonly requiresDeployment: boolean;
  readonly review: Review | null;
  readonly reviewedKey: string | null;
  readonly stage: TransferStage;
  readonly transactionHash: string | null;
};

const initialTransferState = (): TransferState => ({
  error: "",
  fields: null,
  requiresDeployment: false,
  review: null,
  reviewedKey: null,
  stage: "details",
  transactionHash: null,
});

let transferState = initialTransferState();
let transferEpoch = 0;
let repaintActiveTransfer: (() => void) | null = null;
let transferApp: Element | null = null;

const transferKey = (fields: TransferFields): string =>
  JSON.stringify({
    accountId: fields.accountId,
    amount: fields.amount,
    recipient: fields.recipient,
    speed: fields.speed,
    tokenId: fields.tokenId,
  });

const setText = (root: Element, id: string, text: string): void => {
  const node = root.querySelector(`#${id}`);
  if (node) {
    node.textContent = text;
  }
};

const setSendProgress = (form: HTMLFormElement, stage: TransferStage): void => {
  const activeIndex =
    stage === "details"
      ? 0
      : stage === "review" || stage === "reviewing"
        ? 1
        : stage === "submitted"
          ? 3
          : 2;
  const steps = form.querySelectorAll<HTMLElement>("[data-send-step]");
  steps.forEach((step, index) => {
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
    amount: fields.amount,
    recipient: fields.recipient,
    speed: fields.speed,
    tokenId: fields.tokenId,
  };
  for (const [name, value] of Object.entries(values)) {
    const control = form.elements.namedItem(name);
    if (
      (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) &&
      control !== control.ownerDocument.activeElement
    ) {
      control.value = value;
    }
  }
};

const reviewReceiptHtml = (fields: TransferFields): string =>
  receiptRows([
    { label: "Amount", value: `${fields.amount} ${fields.tokenSymbol}` },
    { label: "Recipient", value: fields.recipient, valueStyle: "code" },
    { label: "Speed", value: fields.speed === "fast" ? "Fast" : "Standard" },
  ]);

type WorkingStatus = {
  readonly copy: string;
  readonly labels: readonly [string, string, string];
  readonly states: readonly [
    "active" | "done" | "pending",
    "active" | "done" | "pending",
    "active" | "done" | "pending",
  ];
  readonly title: string;
};

const workingStatus = (state: TransferState): WorkingStatus => {
  if (state.stage === "reviewing") {
    return {
      copy: "Validating the recipient, decoding the exact calls, and estimating the network fee.",
      labels: ["Validate details", "Decode transaction", "Estimate fee"],
      states: ["active", "pending", "pending"],
      title: "Preparing a safe review",
    };
  }
  if (state.stage === "broadcasting") {
    return {
      copy: "The reviewed transaction is being handed to Starknet. Keep this panel open.",
      labels: ["Review locked", "Device approval verified", "Broadcast to Starknet"],
      states: ["done", "done", "active"],
      title: "Device approval verified",
    };
  }
  const ledger = state.fields?.signer === "ledger";
  return {
    copy: ledger
      ? "Follow the Ledger prompt. Nothing is broadcast until the device approval passes verification."
      : "MC Wallet is authorizing the locked review and sending it to Starknet.",
    labels: ledger
      ? ["Review locked", "Approve on Ledger", "Broadcast to Starknet"]
      : ["Review locked", "Sign securely", "Broadcast to Starknet"],
    states: ["done", "active", "pending"],
    title: ledger ? "Waiting for your Ledger" : "Signing and submitting",
  };
};

const setTaskStatus = (
  form: HTMLFormElement,
  task: "authorize" | "broadcast" | "review",
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
  const state = transferState;
  const currentForm = form;
  const previousStage = currentForm.dataset["stage"];
  const reviewing = state.stage === "reviewing";
  const authorizing = state.stage === "authorizing" || state.stage === "broadcasting";
  const reviewVisible = state.stage === "review";
  currentForm.dataset["stage"] = state.stage;
  currentForm.toggleAttribute("aria-busy", reviewing || authorizing);
  currentForm.querySelector("#send-details")?.toggleAttribute("hidden", state.stage !== "details");
  currentForm.querySelector("#send-review-stage")?.toggleAttribute("hidden", !reviewVisible);
  currentForm
    .querySelector("#send-working")
    ?.toggleAttribute("hidden", !(reviewing || authorizing));
  currentForm
    .querySelector("#send-success")
    ?.toggleAttribute("hidden", state.stage !== "submitted");
  setSendProgress(currentForm, state.stage);
  restoreTransferFields(currentForm, state.fields);

  const reviewButton = form.querySelector<HTMLButtonElement>("#send-review-button");
  buttonBusy(reviewButton, reviewing);
  const confirmButton = form.querySelector<HTMLButtonElement>("#send-confirm-button");
  buttonBusy(confirmButton, authorizing);
  if (confirmButton && !authorizing) {
    confirmButton.disabled = state.review?.feeEstimateFailed === true;
  }
  setText(
    form,
    "send-confirm-label",
    state.error
      ? "Try send again"
      : state.fields?.signer === "ledger"
        ? "Approve with Ledger"
        : "Confirm and send",
  );

  const reviewPanelEl = form.querySelector<HTMLElement>("#review-panel");
  if (reviewPanelEl) {
    reviewPanelEl.innerHTML = state.review ? reviewPanelHtml(state.review) : "";
  }
  const receipt = form.querySelector<HTMLElement>("#send-review-receipt");
  if (receipt) {
    receipt.innerHTML = state.fields ? reviewReceiptHtml(state.fields) : "";
  }
  reviewPanelEl
    ?.querySelector<HTMLButtonElement>("#review-retry-fee")
    ?.addEventListener("click", () => form.requestSubmit());

  if (reviewing || authorizing) {
    const status = workingStatus(state);
    setText(form, "send-working-title", status.title);
    setText(form, "send-working-copy", status.copy);
    setTaskStatus(form, "review", status.labels[0], status.states[0]);
    setTaskStatus(form, "authorize", status.labels[1], status.states[1]);
    setTaskStatus(form, "broadcast", status.labels[2], status.states[2]);
  }

  if (state.stage === "submitted" && state.fields && state.transactionHash) {
    setText(
      form,
      "send-success-summary",
      `${state.fields.amount} ${state.fields.tokenSymbol} sent to ${accountLabel(state.fields.recipient)}`,
    );
    setText(form, "send-success-hash", state.transactionHash);
  }
  setText(form, "transfer-result", state.error);
  if (previousStage && previousStage !== state.stage) {
    const ownerDocument = currentForm.ownerDocument;
    ownerDocument.documentElement.scrollTop = 0;
    ownerDocument.body.scrollTop = 0;
  }
};

/**
 * Advances an in-wallet Ledger send from device authorization to network
 * broadcast after verified approval; unrelated or inactive requests are ignored.
 */
export const markTransferLedgerAuthorized = (): void => {
  if (transferState.stage !== "authorizing" || transferState.fields?.signer !== "ledger") {
    return;
  }
  transferState = { ...transferState, stage: "broadcasting" };
  repaintActiveTransfer?.();
};

/**
 * Binds the staged Send form: details, decoded review, authorization/broadcast,
 * and a receipt whose progress survives Ledger-driven shell repaints.
 */
export const bindTransfer = ({ app, navigate, render, wallet }: TransferUiDeps): void => {
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
  const recipientInput = form?.querySelector<HTMLInputElement>('input[name="recipient"]');
  const accountId = String(new FormData(form).get("accountId") ?? "");
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

  const editDetails = (): void => {
    transferEpoch += 1;
    transferState = {
      ...initialTransferState(),
      fields: transferState.fields,
    };
    recipientInput?.setCustomValidity("");
    repaint();
    recipientInput?.focus();
  };

  form.querySelector("#send-edit")?.addEventListener("click", editDetails);
  form.querySelector("#send-another")?.addEventListener("click", () => {
    transferEpoch += 1;
    form.reset();
    transferState = initialTransferState();
    repaint();
    form.querySelector<HTMLInputElement>('input[name="recipient"]')?.focus();
  });
  form
    .querySelector("#send-view-activity")
    ?.addEventListener("click", () => navigate?.("activity"));

  form.addEventListener("input", () => {
    if (transferState.stage !== "details") {
      return;
    }
    transferState = { ...initialTransferState(), fields: transferFields(form) };
    recipientInput?.setCustomValidity("");
    repaint();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const fields = transferFields(form);

    const recipientError = recipientFieldError(fields.recipient);
    if (recipientError) {
      recipientInput?.setCustomValidity(recipientError);
      recipientInput?.reportValidity();
      transferState = { ...transferState, error: recipientError, fields, stage: "details" };
      repaint();
      return;
    }

    const key = transferKey(fields);

    if (transferState.reviewedKey !== key) {
      const epoch = ++transferEpoch;
      transferState = {
        ...initialTransferState(),
        fields,
        stage: "reviewing",
      };
      repaint();
      void wallet
        .reviewTransfer(fields.accountId, fields.tokenId, fields.recipient, fields.amount)
        .then(
          (review) => {
            if (epoch !== transferEpoch) {
              return;
            }
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
            if (epoch !== transferEpoch) {
              return;
            }
            const message = friendlyReviewError(error);
            showToast(message, "error");
            transferState = { ...initialTransferState(), error: message, fields };
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
          if (epoch !== transferEpoch) {
            return;
          }
          transferState = {
            ...transferState,
            stage: "submitted",
            transactionHash,
          };
          repaintActiveTransfer?.();
          showToast("Transaction sent to Starknet", "success");
          // A first send also deploys the account; watch for it going live so
          // the home "deploy now" banner clears without a manual refresh.
          if (requiresDeployment) {
            void watchDeployment({ render, wallet });
          }
        },
        (error: unknown) => {
          if (epoch !== transferEpoch) {
            return;
          }
          const message = errorMessage(error, "Transfer failed");
          showToast(message, "error");
          transferState = {
            ...transferState,
            error: `Not sent — ${message}`,
            stage: "review",
          };
          repaintActiveTransfer?.();
        },
      );
  });
};
