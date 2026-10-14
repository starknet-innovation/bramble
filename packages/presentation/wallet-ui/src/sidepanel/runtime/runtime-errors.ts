/**
 * One way to turn a refused background reply into an Error the side panel can
 * show.
 *
 * Trust boundary: the reply is untrusted until `isErrorResponse` has vouched for
 * it, so the message shown to the user is either the background's own curated
 * string or the caller's fallback — never an arbitrary value reflected out of an
 * unrecognised response. Defined once because every panel client needs exactly
 * this, and three private copies of a two-line helper is how the fallback
 * wording, and then the narrowing, quietly drift apart.
 */
import { INDETERMINATE_RPC_WRITE_MESSAGE } from "@bramble/starknet/provider";
import { readPrivacyBlockerError } from "@bramble/wallet-protocol/privacy-blocker";
import {
  readSubmissionUnknownError,
  SubmissionUnknownError,
} from "@bramble/wallet-protocol/submission-unknown";
import { isErrorResponse } from "../../popup/responses/responses";
import { friendlyError } from "./friendly-error";
import { REQUEST_UNKNOWN } from "./friendly-error-copy";

/**
 * Builds the Error a panel client rejects with. `fallback` is used whenever the
 * reply is not a recognised error response — including when it is a success
 * shape the caller's guard refused. A strictly validated "submission status
 * unknown" reply becomes a `SubmissionUnknownError`, so callers can tell a
 * write that may have landed from one that certainly did not.
 */
export const responseError = (response: unknown, fallback: string): Error =>
  readSubmissionUnknownError(response) ??
  readPrivacyBlockerError(response) ??
  new Error(isErrorResponse(response) ? response.error : fallback);

/**
 * A lost reply to a write names no action ({@link lostReplySend} cannot know
 * it); a client that knows which write it sent re-labels it with that write's
 * own outcome-unknown code, so the reader is told what may not have gone
 * through. Anything else passes through unchanged.
 */
export const relabelLostReply = (error: unknown, code: string): unknown =>
  error instanceof SubmissionUnknownError &&
  error.transactionHash === null &&
  error.message === REQUEST_UNKNOWN
    ? new SubmissionUnknownError(code, null)
    : error;

// The ending every outcome-unknown sentence in the copy table shares
// (SUBMISSION_UNKNOWN, REQUEST_UNKNOWN, OUTCOME_UNKNOWN, the Ledger "didn't
// finish" line): an error shown with one of them is never styled as failed.
const READS_AS_UNKNOWN = /check activity before trying again\.$/i;

/**
 * Whether a rejected panel call is a write whose outcome is unknown rather than
 * a failure: a typed {@link SubmissionUnknownError}, the single-sourced
 * indeterminate-write sentence a lane passed through as a plain error, or an
 * unrecognised-reply fallback whose reviewed sentence already says the outcome
 * is unknown ("transfer failed", "deployment failed", "approval failed"). Such a
 * write may already be on chain, so it is shown as a warning and never styled
 * as "failed", which would invite a blind re-send (issue 382).
 */
export const isOutcomeUnknown = (error: unknown): boolean =>
  error instanceof SubmissionUnknownError ||
  (error instanceof Error &&
    (error.message === INDETERMINATE_RPC_WRITE_MESSAGE ||
      READS_AS_UNKNOWN.test(friendlyError(error.message).message)));

/**
 * The toast tone for a rejected panel call: amber for an outcome the wallet
 * cannot establish ({@link isOutcomeUnknown}), red only for a known failure.
 */
export const failureTone = (error: unknown): "error" | "warning" =>
  isOutcomeUnknown(error) ? "warning" : "error";

/**
 * Panel messages that only read, so a lost reply changed nothing and the
 * caller may say "try again". Closed on purpose: every other message — an
 * approval decision, a revoke, a send, a multisig or privacy action, a saved
 * setting — may have run before its reply was lost.
 */
export const READ_ONLY_MESSAGES: ReadonlySet<string> = new Set([
  "wallet.accountSignability",
  "wallet.activity",
  "wallet.allowances",
  "wallet.argentMultisigClassStatus",
  "wallet.connectedSites",
  "wallet.deploymentStatus",
  "wallet.diagnostics",
  "wallet.discoverNfts",
  "wallet.discoverOwnAccounts",
  "wallet.discoverRecoveryAccounts",
  "wallet.getBalances",
  "wallet.ledgerAccountStatus",
  "wallet.ledgerSignPending",
  "wallet.loadWatchedNfts",
  "wallet.multisigBalances",
  "wallet.multisigs",
  "wallet.nostrPublicKey",
  "wallet.pendingApprovals",
  "wallet.preferences",
  "wallet.previewAccount",
  "wallet.prices",
  "wallet.resolveMultisigSigner",
  "wallet.resolveStarkName",
  "wallet.reviewArgentMultisigDeployment",
  "wallet.reviewArgentRecovery",
  "wallet.reviewBraavosRecovery",
  "wallet.reviewNftTransfer",
  "wallet.reviewTransfer",
  "wallet.status",
  "wallet.strk20PreparationStatus",
  "wallet.strk20RecipientStatus",
  "wallet.strk20ShadowAccountBalances",
  "wallet.strk20ShadowAccounts",
  "wallet.strk20State",
  "wallet.swapQuote",
  "wallet.swapTokens",
  "wallet.tokenChart",
  "wallet.validateMnemonic",
  "wallet.verifyClassHash",
]);

const messageType = (message: unknown): unknown =>
  typeof message === "object" && message !== null
    ? (message as Record<string, unknown>)["type"]
    : undefined;

/**
 * Wraps a runtime's `sendMessage` for a panel client. The browser rejects the
 * call when the worker stopped or never answered ("The message port closed
 * before a response was received."), which says nothing about whether the
 * request ran. For a read the rejection passes through and reads as "try
 * again"; for anything else it becomes a {@link SubmissionUnknownError}, so the
 * screen shows an outcome-unknown warning rather than a failure or raw browser
 * text (errors audit F3).
 */
export const lostReplySend =
  (runtime?: { readonly sendMessage: (message: unknown) => Promise<unknown> }) =>
  async (message: unknown): Promise<unknown> => {
    try {
      return await runtime?.sendMessage(message);
    } catch (error) {
      const type = messageType(message);
      if (typeof type === "string" && READ_ONLY_MESSAGES.has(type)) throw error;
      throw new SubmissionUnknownError(REQUEST_UNKNOWN, null);
    }
  };
