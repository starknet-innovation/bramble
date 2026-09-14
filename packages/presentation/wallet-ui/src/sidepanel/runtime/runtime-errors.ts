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
import { isErrorResponse } from "../../popup/responses/responses";

/**
 * Builds the Error a panel client rejects with. `fallback` is used whenever the
 * reply is not a recognised error response — including when it is a success
 * shape the caller's guard refused.
 *
 * A response's `detail` — the uncurated node reason, present only on the paths
 * that have one — rides along as the Error's `cause`, so a surface that wants
 * the long form can reach it via {@link errorCause} without every caller
 * threading a second value through.
 */
export const responseError = (response: unknown, fallback: string): Error => {
  if (!isErrorResponse(response)) {
    return new Error(fallback);
  }
  return response.detail === undefined
    ? new Error(response.error)
    : new Error(response.error, { cause: response.detail });
};

/**
 * Reads the diagnostic detail {@link responseError} attached to an Error, or
 * `undefined` when there is none. Only a string cause counts — anything else is
 * some other layer's cause and is not ours to display.
 */
export const errorCause = (error: unknown): string | undefined =>
  error instanceof Error && typeof error.cause === "string" ? error.cause : undefined;
