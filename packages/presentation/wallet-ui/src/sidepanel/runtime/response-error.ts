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
 */
export const responseError = (response: unknown, fallback: string): Error =>
  new Error(isErrorResponse(response) ? response.error : fallback);
