/** Persistent recipient, review, authorization, confirmation, and receipt bindings. */
import type { TokenBalance, WalletStatus } from "../popup/responses";
import type { SendRouteResolution } from "../starknet/send-routes";
import { errorMessage, showToast } from "./dom";
import type { PrivacyDisclosureState } from "./privacy-model";
import type { SidepanelWallet } from "./runtime";
import { transitionSendStage } from "./send-transition";
import { watchDeployment } from "./shell-bindings";
import { bindTransferBuckets } from "./transfer-buckets-ui";
import { bindTransferCompose, sendFormInput } from "./transfer-compose-ui";
import type { TransferState } from "./transfer-model";
import {
  CONFIRMATION_DELAYS_MS,
  confirmationOutcome,
  confirmationStatus,
  friendlyReviewError,
  initialTransferState,
  recipientFieldError,
  type TransferStage,
  transferFields,
  transferKey,
} from "./transfer-model";
import { createRecipientStatus } from "./transfer-recipient-status";
import { applyTransferUi } from "./transfer-render";
import {
  balanceInBucket,
  resolveTransferRoute,
  type TransferRouteContext,
  transferRoute,
  transferSpendable,
} from "./transfer-route";
import { preparationFailure, preparationFor, preparedReview } from "./transfer-submit";

export { activityExportToast, bindActivity } from "./activity-ui";
export { friendlyReviewError, recipientFieldError } from "./transfer-model";
export { reviewPanelHtml } from "./transfer-review-markup";

type Review = Awaited<ReturnType<SidepanelWallet["reviewTransfer"]>>;

const EMPTY_BALANCES: readonly TokenBalance[] = [];

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
  /** The account's public token balances, for bucket display and fee gating. */
  readonly publicBalances?: () => readonly TokenBalance[];
  /** Retries account-scoped privacy discovery after a route read failure. */
  readonly reloadPrivacy?: () => void;
  readonly render: (status: WalletStatus) => Promise<void>;
  /** Active account address, so a send to yourself is recognised as such. */
  readonly senderAddress?: () => string;
  readonly waitForConfirmation?: (delayMs: number) => Promise<void>;
  readonly wallet: SidepanelWallet;
};

let transferState: TransferState<Review> = initialTransferState();
let transferEpoch = 0;
let repaintActiveTransfer: (() => void) | null = null;
let transferApp: Element | null = null;

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
  // A shortcut arrives with the recipient, the asset, and both buckets already
  // in the form, so the recipient step has nothing left to ask: open on the
  // amount. Only on a fresh journey, or a repaint would drag the user back here
  // from review.
  if (transferState.fields === null && sendFormInput(form, "recipient")?.value) {
    transferState = { ...transferState, fields: transferFields(form), stage: "details" };
  }
  const repaint = (): void =>
    transitionSendStage(form.ownerDocument, form.dataset["stage"], transferState.stage, () =>
      applyTransferUi(form, transferState, deps.privacy?.().value?.poolFeeFri),
    );
  repaintActiveTransfer = repaint;
  repaint();
  const goTo = (stage: TransferStage): void => {
    transferState = { ...transferState, fields: transferFields(form), stage };
    repaint();
  };
  // Leaving the review discards it. `reviewedKey` is what the submit handler
  // reads to tell "show me the review" from "I have read it, send it", so a
  // return to the amount step that kept it made the next Review send button
  // submit immediately. Every path out of review goes through here.
  const editDetails = (): void => {
    transferEpoch += 1;
    transferState = {
      ...transferState,
      error: "",
      privatePreparation: null,
      review: null,
      reviewedKey: null,
      stage: "details",
    };
    repaint();
    form.querySelector<HTMLInputElement>("#send-amount-input")?.focus();
  };
  // Closing Send abandons what was composed. Without this, the module-level
  // journey survived the close and the next visit resumed mid-flow — a cancelled
  // shield reopened as a half-filled shield. A submitted transaction is kept, so
  // its receipt or pending screen is still reachable on return.
  const exit = (): void => {
    if (transferState.transactionHash === null) {
      transferEpoch += 1;
      transferState = initialTransferState();
    }
    if (back) {
      back();
      return;
    }
    navigate?.("home");
  };
  form.ownerDocument.querySelector("#send-close")?.addEventListener("click", exit);
  form.ownerDocument.querySelector("#send-header-back")?.addEventListener("click", () => {
    if (transferState.stage === "asset") goTo("details");
    else if (transferState.stage === "details") goTo("recipient");
    else if (transferState.stage === "review") editDetails();
    else exit();
  });
  const recipients = createRecipientStatus({
    onSettled: () => repaintActiveTransfer?.(),
    wallet,
  });
  const routeContext = (): TransferRouteContext => {
    const fields = transferFields(form);
    return {
      fields,
      privacy: deps.privacy?.() ?? { error: null, loading: false, value: null },
      publicBalances: deps.publicBalances?.() ?? EMPTY_BALANCES,
      recipientRegistration: recipients.status(fields.recipient),
      senderAddress: deps.senderAddress?.() ?? "",
    };
  };
  // The recipient answer is a network round trip, so it is only started once a
  // route actually depends on it — a public destination never needs it.
  const route = (): SendRouteResolution => {
    const context = routeContext();
    if (context.fields.destination === "private" && context.fields.recipient) {
      recipients.check(context.fields.tokenId, context.fields.recipient);
    }
    return resolveTransferRoute(context);
  };
  const dropReview = (): void => {
    transferState = {
      ...transferState,
      fields: transferFields(form),
      privatePreparation: null,
      review: null,
      reviewedKey: null,
    };
  };
  bindTransferCompose({
    form,
    goTo,
    onFields: (fields) => {
      transferState = { ...transferState, fields };
    },
    spendable: () => transferSpendable(routeContext()),
  });
  bindTransferBuckets({
    balanceIn: (bucket) => balanceInBucket(bucket, routeContext()),
    form,
    onRouteChange: dropReview,
    ...(deps.reloadPrivacy ? { retry: deps.reloadPrivacy } : {}),
    retryable: () => deps.privacy?.().error !== null,
    route,
  });

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
    // The route gate is enforced here, not just rendered: a refusal the user can
    // read is still a refusal they can click past. This covers both the move to
    // review and the final confirm, because both arrive through this handler.
    const gate = route().blocked;
    if (gate) {
      // A final confirm can reach this branch after the state behind the review
      // changed (balance refresh, registration loss, relay removal). Invalidate
      // every reviewed artifact and its async epoch before returning to edit;
      // if the gate later clears, the next click must build a fresh review.
      transferEpoch += 1;
      transferState = {
        ...initialTransferState<Review>(),
        error: gate.reason,
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
      const composed = transferRoute(fields);
      const preparing = preparationFor(composed, fields, wallet);
      if (preparing) {
        void preparing.then(
          (preparation) => {
            if (epoch !== transferEpoch) return;
            transferState = {
              error: "",
              fields,
              privatePreparation: preparation,
              requiresDeployment: false,
              review: preparedReview(preparation),
              reviewedKey: key,
              stage: "review",
              transactionHash: null,
            };
            repaintActiveTransfer?.();
          },
          (error: unknown) => {
            if (epoch !== transferEpoch) return;
            const message = errorMessage(error, preparationFailure(composed));
            showToast(message, "error");
            transferState = { ...initialTransferState(), error: message, fields, stage: "details" };
            repaintActiveTransfer?.();
          },
        );
        return;
      }
      void wallet
        .reviewTransfer(
          fields.accountId,
          fields.tokenId,
          fields.recipient,
          fields.amount,
          fields.speed,
        )
        .then(
          (review) => {
            if (epoch !== transferEpoch) return;
            const feeFailed = review.feeEstimateFailed;
            // Address poisoning is a refusal here, not a notice, matching the
            // NFT send screen (nft-ui.ts) and the background's own refusal on
            // submit: leaving the key unreviewed means the next click re-reviews
            // instead of confirming, so the flag cannot be clicked past.
            const blocked = review.flags.some((flag) => flag.code === "address-poisoning");
            transferState = {
              error: blocked
                ? "This recipient closely mimics a saved address. Change it and review again."
                : feeFailed
                  ? "Fee estimate unavailable. Retry before authorizing this transaction."
                  : "",
              fields,
              privatePreparation: null,
              requiresDeployment: review.requiresDeployment,
              review,
              reviewedKey: blocked || feeFailed ? null : key,
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
    const reviewedFee = transferState.review?.fee ?? null;
    const privatePreparation = transferState.privatePreparation;
    transferState = { ...transferState, error: "", fields, stage: "authorizing" };
    repaint();
    if (transferRoute(fields).id !== "public-public") {
      if (!privatePreparation) {
        transferState = {
          ...transferState,
          error: "Review this send first",
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
        // Exactly what the review step rendered. Sending it back is what lets
        // the background refuse a send whose fee has moved since the user read
        // it, instead of signing at a price they never saw.
        reviewedFee,
      )
      .then(
        (transactionHash) => {
          if (epoch !== transferEpoch) return;
          transferState = { ...transferState, stage: "confirming", transactionHash };
          repaintActiveTransfer?.();
          if (requiresDeployment) {
            void watchDeployment(
              { render, wallet },
              { accountId: fields.accountId, stillCurrent: () => epoch === transferEpoch },
            );
          }
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
