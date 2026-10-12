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
 * Whether a rejected panel call is a write whose outcome is unknown rather than
 * a failure: a typed {@link SubmissionUnknownError}, or the single-sourced
 * indeterminate-write sentence a lane passed through as a plain error. Such a
 * write may already be on chain, so it is shown as a warning and never styled
 * as "failed", which would invite a blind re-send (issue 382).
 */
export const isOutcomeUnknown = (error: unknown): boolean =>
  error instanceof SubmissionUnknownError ||
  (error instanceof Error && error.message === INDETERMINATE_RPC_WRITE_MESSAGE);
