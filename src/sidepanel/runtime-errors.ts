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
import { isErrorResponse } from "../popup/responses";

/**
 * Builds the Error a panel client rejects with. `fallback` is used whenever the
 * reply is not a recognised error response — including when it is a success
 * shape the caller's guard refused.
 */
export const responseError = (response: unknown, fallback: string): Error =>
  new Error(isErrorResponse(response) ? response.error : fallback);
