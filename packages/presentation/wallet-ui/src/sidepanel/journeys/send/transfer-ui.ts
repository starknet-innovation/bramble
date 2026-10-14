/** Persistent recipient, review, authorization, confirmation, and receipt bindings. */

import type { SendRouteResolution } from "@bramble/transactions/send-routes";
import type { TokenBalance, WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { awaitConfirmation } from "../../shared/confirm-submitted";
import { errorDetails, errorLine, errorMessage, showToast } from "../../shared/dom";
import { watchDeployment } from "../../shell/shell-bindings";
import type { PrivacyDisclosureState } from "../privacy/privacy-model";
import type { PreparationProgress } from "../privacy/privacy-preparation-job";
import { transitionSendStage } from "./send-transition";
import { bindTransferBuckets } from "./transfer-buckets-ui";
import { createComposeFee } from "./transfer-compose-fee";
import { bindTransferCompose, clearSendRecipient, sendFormInput } from "./transfer-compose-ui";
import { bindTransferExits } from "./transfer-exits-ui";
import type { TransferExitView, TransferState } from "./transfer-model";
import {
  acceptsTransferSubmit,
  friendlyReviewError,
  initialTransferState,
  isTransferInFlight,
  recipientFieldError,
  type TransferStage,
  transferFields,
  transferKey,
} from "./transfer-model";
import { createRecipientStatus } from "./transfer-recipient-status";
import { applyTransferProgress, applyTransferUi } from "./transfer-render";
import {
  balanceInBucket,
  resolveTransferRoute,
  type TransferRouteContext,
  transferRoute,
  transferSpendable,
} from "./transfer-route";
import {
  confirmedState,
  preparationFailure,
  preparationFor,
  preparedState,
  reviewedState,
  submitRejection,
} from "./transfer-submit";

export { type ActivityUiDeps, activityExportToast, bindActivity } from "../portfolio/activity-ui";
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
  readonly navigate?: (view: TransferExitView) => void;
  /** Invalidates the cached private balance once a private send is accepted. */
  readonly onPrivateSendSettled?: () => void;
  /**
   * Arms the bounded privacy re-read once a private send's confirmation lands.
   * The chain accepts a shield before the privacy indexer reflects the moved
   * note, so the cached reading can predate the move; this watches the settled
   * state so the home shows the shielded balance.
   */
  readonly onPrivateSendConfirmed?: () => void;
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
// A failed review returns the form mounted now, not the one that started it: a
// re-render while preparing replaces it, and the live one stayed "reviewing".
let returnActiveTransferToDetails: (() => void) | null = null;
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
    if (!isTransferInFlight(transferState.stage)) {
      transferEpoch += 1;
      transferState = initialTransferState();
    }
    repaintActiveTransfer = null;
    returnActiveTransferToDetails = null;
    transferApp = app;
    return;
  }
  if (transferApp !== app) {
    transferEpoch += 1;
    transferState = initialTransferState();
    transferApp = app;
  }
  const accountId = sendFormInput(form, "accountId")?.value ?? "";
  const completionTarget =
    form.dataset["sendCompleteTo"] === "multisig-deploy" ? "multisig-deploy" : "home";
  const complete = (): void => {
    if (completionTarget === "multisig-deploy" && back) back();
    else navigate?.(completionTarget);
  };
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
    composeFee.refresh();
  };
  // Leaving the review discards it: `reviewedKey` tells "show me the review"
  // from "send it", so keeping it made the next Review press submit at once.
  // Every path out of review comes here; the epoch bump discards a review still
  // being prepared, which is safe because nothing is signed before the confirm.
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
    goTo("details");
    form.querySelector<HTMLInputElement>("#send-amount-input")?.focus();
  };
  // Closing Send abandons what was composed, so a cancelled shield does not
  // reopen half-filled. A send past the confirm is kept, hash or not: the
  // background still broadcasts it, so its outcome must show on return (audit
  // M2; the rule `bindTransfer` applies to a takeover, Sherlock 164).
  const exit = (): void => {
    if (transferState.transactionHash === null && !isTransferInFlight(transferState.stage)) {
      transferEpoch += 1;
      transferState = initialTransferState();
    }
    if (transferState.transactionHash && completionTarget === "multisig-deploy") {
      complete();
      return;
    }
    if (back) back();
    else navigate?.("home");
  };
  form.ownerDocument.querySelector("#send-close")?.addEventListener("click", exit);
  form.ownerDocument.querySelector("#send-header-back")?.addEventListener("click", () => {
    if (transferState.stage === "details") {
      clearSendRecipient(form);
      goTo("recipient");
    } else if (transferState.stage === "review" || transferState.stage === "reviewing")
      editDetails();
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
  // The Amount screen prices the send from the same route the form composes into.
  const composeFee = createComposeFee({
    context: routeContext,
    form,
    stage: () => transferState.stage,
    wallet,
  });
  returnActiveTransferToDetails = (): void => {
    repaint();
    composeFee.refresh();
  };
  // A bucket flip or an asset pick changes the route, so the cached review goes
  // and the screen is repainted: the header and actions name the operation the
  // buckets now describe (a shield flipped back to public reads as a send).
  const dropReview = (): void => {
    transferState = {
      ...transferState,
      fields: transferFields(form),
      privatePreparation: null,
      review: null,
      reviewedKey: null,
    };
    repaint();
    composeFee.refresh();
  };
  bindTransferCompose({
    form,
    goTo,
    onFields: (fields) => {
      transferState = { ...transferState, fields };
      composeFee.refresh();
    },
    navigate: (view) => deps.navigate?.(view),
    resolveName: (name, networkId) => wallet.resolveStarkName(name, networkId),
    spendable: () => transferSpendable(routeContext()),
  });
  bindTransferBuckets({
    balanceIn: (bucket) => balanceInBucket(bucket, routeContext()),
    form,
    onRouteChange: dropReview,
    ...(deps.reloadPrivacy ? { retry: deps.reloadPrivacy } : {}),
    retryable: () => {
      const fields = transferFields(form);
      return (
        deps.privacy?.().error !== null &&
        (fields.source === "private" || fields.destination === "private")
      );
    },
    route,
  });

  form.querySelector("#send-failure-edit")?.addEventListener("click", editDetails);
  bindTransferExits(form, { complete, completionTarget, navigate });

  // Polls to the last checkpoint, then hands over to "Check again".
  const confirmSubmitted = async (epoch: number): Promise<void> => {
    const hash = transferState.transactionHash;
    if (!hash) return;
    const outcome = await awaitConfirmation({
      ...(deps.confirmationDelaysMs ? { delaysMs: deps.confirmationDelaysMs } : {}),
      hash,
      loadActivity: () => wallet.loadActivity(),
      stillCurrent: () => epoch === transferEpoch,
      ...(deps.waitForConfirmation ? { wait: deps.waitForConfirmation } : {}),
    });
    if (epoch !== transferEpoch) return;
    if (!outcome) {
      transferState = { ...transferState, stage: "pending" };
      repaintActiveTransfer?.();
      return;
    }
    transferState = confirmedState(transferState, outcome);
    repaintActiveTransfer?.();
    // Only a confirmed private route moved a balance the indexer must catch up on.
    const settledRoute = transferState.fields ? transferRoute(transferState.fields).id : null;
    if (outcome.kind === "succeeded" && settledRoute !== null && settledRoute !== "public-public") {
      deps.onPrivateSendConfirmed?.();
    }
    showToast(outcome.toast, outcome.kind === "succeeded" ? "success" : "error", form);
  };
  form.querySelector("#send-check-again")?.addEventListener("click", () => {
    const epoch = ++transferEpoch;
    transferState = { ...transferState, stage: "confirming" };
    repaint();
    void confirmSubmitted(epoch);
  });
  // Every failure has dropped the review, so this submit starts a new one.
  form.querySelector("#send-retry")?.addEventListener("click", () => {
    transferState = { ...transferState, error: "" };
    form.requestSubmit();
  });
  const settleRejection = (epoch: number, error: unknown): void => {
    const rejection = submitRejection(transferState, error);
    transferState = rejection.state;
    repaintActiveTransfer?.();
    if (rejection.toast) showToast(rejection.toast.message, "error", form, rejection.toast.details);
    if (rejection.follow) void confirmSubmitted(epoch);
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!acceptsTransferSubmit(transferState.stage)) return;
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
      // A confirm can land here after the state behind the review changed:
      // drop every reviewed artifact and its epoch, so a later click re-reviews.
      transferEpoch += 1;
      transferState = {
        ...initialTransferState<Review>(),
        error: gate.reason,
        fields,
        stage: "details",
      };
      goTo("details");
      return;
    }
    const key = transferKey(fields);
    // A preparation already running for exactly these fields is not restarted:
    // a second proof for the same send is a minute of wasted work.
    if (
      transferState.stage === "reviewing" &&
      transferState.fields !== null &&
      transferKey(transferState.fields) === key
    ) {
      return;
    }
    // A job's progress poll: rewrite only the liveness line, only for the epoch that started it.
    const progressFor =
      (epoch: number) =>
      (progress: PreparationProgress): void => {
        if (epoch !== transferEpoch) return;
        transferState = { ...transferState, progress };
        applyTransferProgress(form, transferState);
      };
    if (transferState.reviewedKey !== key) {
      const epoch = ++transferEpoch;
      transferState = { ...initialTransferState<Review>(), fields, stage: "reviewing" };
      repaint();
      const composed = transferRoute(fields);
      const preparing = preparationFor(composed, fields, wallet, progressFor(epoch));
      if (preparing) {
        void preparing.then(
          (preparation) => {
            if (epoch !== transferEpoch) return;
            transferState = preparedState(preparation, fields, key, deps.publicBalances?.());
            repaintActiveTransfer?.();
          },
          (error: unknown) => {
            if (epoch !== transferEpoch) return;
            const message = errorMessage(error, preparationFailure(composed));
            showToast(message, "error", form, errorDetails(error, preparationFailure(composed)));
            const line = errorLine(error, preparationFailure(composed));
            transferState = { ...initialTransferState(), error: line, fields, stage: "details" };
            returnActiveTransferToDetails?.();
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
            transferState = reviewedState(review, fields, key);
            repaintActiveTransfer?.();
          },
          (error: unknown) => {
            if (epoch !== transferEpoch) return;
            const message = friendlyReviewError(error);
            showToast(message, "error", form, errorDetails(error, "Transfer review failed"));
            transferState = { ...initialTransferState(), error: message, fields, stage: "details" };
            returnActiveTransferToDetails?.();
          },
        );
      return;
    }
    const epoch = ++transferEpoch;
    const requiresDeployment = transferState.requiresDeployment;
    const reviewedFee = transferState.review?.fee ?? null;
    const reviewedDeploymentFee = transferState.review?.deploymentFee ?? null;
    const privatePreparation = transferState.privatePreparation;
    transferState = { ...transferState, error: "", fields, progress: null, stage: "authorizing" };
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
      void wallet.executePrivacyPreparation(privatePreparation.id, progressFor(epoch)).then(
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
          if (epoch === transferEpoch) settleRejection(epoch, error);
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
        reviewedDeploymentFee,
      )
      .then(
        (transactionHash) => {
          if (epoch !== transferEpoch) return;
          // The review is spent: like the private route, drop its key (audit L5).
          transferState = {
            ...transferState,
            reviewedKey: null,
            stage: "confirming",
            transactionHash,
          };
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
          if (epoch === transferEpoch) settleRejection(epoch, error);
        },
      );
  });
};
