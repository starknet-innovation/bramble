/**
 * Route dispatch for a composed send: which preparation a route needs, and what
 * the review looks like once it lands.
 *
 * All three pool routes share one shape — prepare, review, then execute the
 * prepared batch by id — while a public transfer keeps the estimate-and-submit
 * path. Keeping the mapping here means the Send binding branches once on the
 * route rather than once per privacy feature.
 */

import { resolveFeeAffordability } from "@bramble/transactions/fee-funds";
import type { SendRoute } from "@bramble/transactions/send-routes";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import type { TokenBalance } from "../../../popup/responses/responses";
import { friendlyError } from "../../runtime/friendly-error";
import type { SidepanelWallet } from "../../runtime/runtime";
import type { ConfirmationOutcome } from "../../shared/confirm-submitted";
import { errorDetails } from "../../shared/dom";
import { reviewFeeBlocked } from "../../shared/review-render";
import { knownNotSent, outcomeUnknownReason, priorWriteRefusal } from "../../shared/submit-outcome";
import type { PreparationProgressSink, PrivacyPreparation } from "../privacy/privacy-runtime";
import type { TransferFields, TransferState } from "./transfer-model";
import { shieldStrkFunding, transferRoute } from "./transfer-route";

type ShieldStrkFunding = ReturnType<typeof shieldStrkFunding>;

/**
 * Review shape the Send screen renders. Structurally the public review, so the
 * pool routes synthesize one from their preparation.
 */
export type TransferReview = Awaited<ReturnType<SidepanelWallet["reviewTransfer"]>>;

const preparePrivateRoute = (
  route: SendRoute,
  fields: TransferFields,
  wallet: SidepanelWallet,
  onProgress?: PreparationProgressSink,
): Promise<PrivacyPreparation> => {
  if (route.id === "public-private") {
    // Every route passes the composed recipient through, deposits included. The
    // recipient being a required argument rather than an optional extra is what
    // makes the old failure structurally unreachable: a deposit that ignored it
    // shielded to the sender while every screen reported a payment to a friend.
    // The shield proves at review inside a tracked job; its progress feeds the
    // working screen. The relayed routes only quote here and report nothing.
    return wallet.preparePrivacyDeposit(
      fields.tokenId,
      fields.amount,
      fields.recipient,
      onProgress,
    );
  }
  if (route.id === "private-private") {
    return wallet.preparePrivacyTransfer(fields.tokenId, fields.recipient, fields.amount);
  }
  return wallet.preparePrivacyWithdraw(fields.tokenId, fields.recipient, fields.amount);
};

/**
 * Starts the preparation a pool route needs, or `null` for a public transfer,
 * which reviews through the fee estimator instead.
 *
 * The recipient policy is NOT applied here. It is enforced in the background,
 * inside each preparation handler (the extension's background/privacy/strk20-send-ops.ts), through
 * the same shared `refuseOnPoisonedRecipient` the public ERC20 send, the NFT
 * send, the swap, and the dapp invoke use. That placement is the point: this
 * message is untrusted like any other, so a panel-side gate could only ever be
 * advisory, and duplicating the verifier's trusted-set scoping here would be a
 * fourth copy of a rule that must not drift. A refused recipient rejects the
 * returned promise with the verifier's own wording and prepares nothing.
 */
export const preparationFor = (
  route: SendRoute,
  fields: TransferFields,
  wallet: SidepanelWallet,
  onProgress?: PreparationProgressSink,
): Promise<PrivacyPreparation> | null =>
  route.id === "public-public" ? null : preparePrivateRoute(route, fields, wallet, onProgress);

/**
 * The copy shown when a route's preparation fails, named per route so the toast
 * says which leg of the move did not happen.
 */
export const preparationFailure = (route: SendRoute): string => {
  if (route.id === "public-private") {
    return "Shielding preparation failed";
  }
  if (route.id === "private-public") {
    return "Unshielding preparation failed";
  }
  return "Private send preparation failed";
};

/**
 * Builds the review a pool route shows from its preparation.
 *
 * A relayed route pays the network fee through the relay and recovers the pool
 * charge from the private balance, so its `feeAffordability` is `"unknown"`
 * (no notice). A shield pays its network fee, the pool fee, and (for STRK) the
 * amount from the public STRK balance; with `funding` the review runs the
 * shared warn-only predicate over all three, so a Max shield whose network fee
 * the balance cannot cover is flagged before Confirm.
 *
 * `flags` is empty by construction, not by omission. The only recipient flag
 * that can refuse a send — address poisoning — is applied in the background
 * before a preparation exists, so a preparation this function is handed is one
 * whose recipient already passed it; `self-transfer` is the ordinary case for a
 * shield or an unshield to your own account, and `unknown-contract` is a
 * statement about a token the route resolved from the wallet's own list. A flag
 * rendered here would therefore be either impossible or noise.
 */
export const preparedReview = (
  preparation: PrivacyPreparation,
  funding: ShieldStrkFunding = null,
): TransferReview =>
  ({
    fee: preparation.networkFee ?? null,
    feeAffordability:
      funding && preparation.route === "public-account"
        ? resolveFeeAffordability({
            balance: funding.balance,
            fee: preparation.networkFee ?? null,
            sendAmount: funding.spent,
          })
        : "unknown",
    feeEstimateFailed: preparation.route === "public-account" && !preparation.networkFee,
    flags: [],
    requiresDeployment: false,
    summaries: [...preparation.summaries],
  }) as TransferReview;

const FEE_UNAVAILABLE = "Fee estimate unavailable. Retry before authorizing this transaction.";

/**
 * The review state a public transfer lands in. The reviewed key — what the
 * submit handler reads to tell "show me the review" from "I have read it, send
 * it" — is withheld when the fee could not be estimated or the recipient trips
 * the poisoning rule, so the next click re-reviews instead of confirming.
 * Address poisoning is a refusal here, not a notice, matching the NFT send
 * screen (nft-ui.ts) and the background's own refusal on submit.
 */
export const reviewedState = (
  review: TransferReview,
  fields: TransferFields,
  key: string,
): TransferState<TransferReview> => {
  const feeFailed = reviewFeeBlocked(review);
  const blocked = review.flags.some((flag) => flag.code === "address-poisoning");
  return {
    error: blocked
      ? "This recipient closely mimics a saved address. Change it and review again."
      : feeFailed
        ? FEE_UNAVAILABLE
        : "",
    fields,
    privatePreparation: null,
    progress: null,
    requiresDeployment: review.requiresDeployment,
    review,
    reviewedKey: blocked || feeFailed ? null : key,
    stage: "review",
    submissionUnknown: false,
    transactionHash: null,
  };
};

/**
 * The review state a pool route lands in once its preparation exists. Same
 * rule as the public path: a review whose fee could not be estimated is not a
 * reviewed key, so the fee retry re-prepares instead of executing what the user
 * has not been able to read.
 */
export const preparedState = (
  preparation: PrivacyPreparation,
  fields: TransferFields,
  key: string,
  publicBalances?: readonly TokenBalance[],
): TransferState<TransferReview> => {
  const review = preparedReview(
    preparation,
    shieldStrkFunding(fields, publicBalances, preparation.poolFeeFri),
  );
  return {
    error: review.feeEstimateFailed ? FEE_UNAVAILABLE : "",
    fields,
    privatePreparation: preparation,
    progress: null,
    requiresDeployment: false,
    review,
    reviewedKey: review.feeEstimateFailed ? null : key,
    stage: "review",
    submissionUnknown: false,
    transactionHash: null,
  };
};

/**
 * What a rejected confirm does to the Send state: the next state, whether to
 * follow a captured hash through confirmation, and the toast to show (if any).
 * A toast carries the rejected call's complete diagnostic as `details`, so its
 * copy control hands support the cause rather than the toast's own headline.
 */
export type SubmitRejection = {
  readonly follow: boolean;
  readonly state: TransferState<TransferReview>;
  readonly toast: { readonly details: string; readonly message: string } | null;
};

/**
 * The journey state once a submitted transaction's outcome is known. A
 * success lands on the receipt; a failure drops the review, so Try again
 * reviews afresh rather than re-signing the old one (audit 247).
 */
export const confirmedState = <Review>(
  state: TransferState<Review>,
  outcome: ConfirmationOutcome,
): TransferState<Review> =>
  outcome.kind === "succeeded"
    ? { ...state, error: "", stage: "submitted" }
    : {
        ...state,
        error: outcome.message,
        // No rejected call lies behind a chain rejection, so the receipt copies
        // the reason itself — never a diagnostic left over from an earlier try.
        errorDetails: "",
        review: null,
        priorWrite: null,
        reviewedKey: null,
        stage: "failed",
        submissionUnknown: false,
      };

const NOT_SENT_TOAST = "Transaction was not sent";

/**
 * Settles a rejected submit (public) or execute (pool route).
 *
 * Every branch drops the review and its key, so Try again always runs a fresh
 * review before anything is signed again (audits 173 and 247). "Not sent" is
 * said only for the closed set of pre-submit refusals in `knownNotSent`; any
 * other rejection — a lost or unrecognised reply, the router's catch-all, an
 * unreviewed message — may already be on chain (errors audit F1). A
 * {@link SubmissionUnknownError} with a captured hash is followed like any
 * submitted transaction; every other unknown outcome says so and offers
 * Activity instead of a re-send. Every failed branch keeps the complete
 * diagnostic beside its sentence, for the receipt's copy control.
 */
export const submitRejection = (
  state: TransferState<TransferReview>,
  error: unknown,
): SubmitRejection => {
  const details = errorDetails(error, "");
  const cleared: TransferState<TransferReview> = {
    ...state,
    errorDetails: details,
    priorWrite: null,
    privatePreparation: null,
    progress: null,
    review: null,
    reviewedKey: null,
  };
  if (error instanceof SubmissionUnknownError && error.transactionHash) {
    return {
      follow: true,
      state: {
        ...cleared,
        error: "",
        stage: "confirming",
        submissionUnknown: false,
        transactionHash: error.transactionHash,
      },
      toast: null,
    };
  }
  // The background refused before this attempt claimed the pool, because an
  // EARLIER private write may still land. This attempt was not sent, which the
  // title says; the sentence keeps the earlier write's may-be-in-flight fact,
  // and the receipt offers Activity and Check again, which prepares afresh and
  // so re-runs the background's resolution (mc-wallet issue 661).
  const priorWrite = priorWriteRefusal(error);
  if (priorWrite !== null) {
    return {
      follow: false,
      state: {
        ...cleared,
        error: friendlyError(details).message,
        priorWrite,
        stage: "failed",
        submissionUnknown: false,
      },
      toast: null,
    };
  }
  if (knownNotSent(error)) {
    return {
      follow: false,
      state: {
        ...cleared,
        error: `The transaction was not sent. ${friendlyError(details).message}`,
        stage: "failed",
        submissionUnknown: false,
      },
      toast: { details: details || NOT_SENT_TOAST, message: NOT_SENT_TOAST },
    };
  }
  const pooled = state.fields !== null && transferRoute(state.fields).id !== "public-public";
  return {
    follow: false,
    state: {
      ...cleared,
      error: outcomeUnknownReason(error, pooled ? "The private transaction" : "The transfer"),
      stage: "failed",
      submissionUnknown: true,
    },
    toast: null,
  };
};
