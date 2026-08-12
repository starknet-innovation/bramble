/**
 * Turns a rejected background response into an Error the panel can surface.
 *
 * Single-sourced because every panel client needs it and the alternative is a
 * private copy per module: three already existed before this module, and a
 * fourth would have been added for the accounts client. The behavior is
 * load-bearing — a background error's own message is preferred so the user reads
 * the real reason, and `fallback` covers a reply that is not a recognized error
 * envelope, which must never surface as "undefined".
 */

import { isErrorResponse } from "../../popup/responses/responses";

/**
 * Builds the Error for a background response that is not the expected success
 * shape, preferring the response's own message over `fallback`.
 *
 * A response's `detail` — the uncurated reason, present on the paths that have
 * one — rides along as the Error's `cause`, so a surface that wants the long
 * form can reach it via {@link errorCause} without every caller threading a
 * second value through.
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
