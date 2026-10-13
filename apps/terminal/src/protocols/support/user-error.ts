/**
 * Decides what a terminal screen shows for a caught error (mc-wallet issue 652).
 *
 * The screens used to print `cause.message` as written, so the terminal's own
 * plumbing diagnostics — "Could not quote Vesu wind route", "Invalid AVNU build
 * response", an HTTP error carrying a URL and a response body — reached the
 * reader. This module is the one place that decides, in this order:
 *
 * 1. `REVIEWED_COPY`: a diagnostic someone has written a sentence for. Adding a
 *    reviewed sentence for any message below is a one-line change here.
 * 2. Transport errors (`HttpError`, `ResponseTooLargeError`, `ExtendedApiError`)
 *    collapse to the sink's own fallback: their text carries URLs, byte limits
 *    and upstream response bodies.
 * 3. `FACT_GUARD`: a message naming a security or cryptographic fact — a hash,
 *    proof, signature, mismatch, substituted route, unregistered contract, a
 *    check that could not verify — is never collapsed. The reader is told what
 *    failed, in the words it failed with, until reviewed copy replaces them.
 * 4. `REVIEWED_PLUMBING`: the terminal's own plumbing messages, listed
 *    exactly and raised as its own `WalletError`, collapse to the sink's
 *    existing fallback sentence. There are no prefix families.
 * 5. Anything else passes through unchanged: the screens' own sentences, and
 *    errors raised by the connected wallet or a Ledger behind it, which the
 *    terminal does not own and must not reword.
 *
 * Pure: no DOM, clock, or network access. It never invents copy — a collapsed
 * message becomes the fallback the calling screen already showed.
 */

import { WalletError } from "./errors";

/** Diagnostic (exact text) to a reviewed sentence. Empty until copy is approved. */
const REVIEWED_COPY: ReadonlyMap<string, string> = new Map<string, string>([]);

/** Error class names whose message is transport detail, never reader copy. */
const TRANSPORT_ERROR_NAMES: ReadonlySet<string> = new Set([
  "HttpError",
  "ResponseTooLargeError",
  "ExtendedApiError",
]);

/**
 * A message that states a security or cryptographic fact. Matched before the
 * internal families, so a fact is kept even when its wording is also plumbing
 * ("Invalid Vesu reward proof", "Wallet returned an invalid transaction hash.").
 */
const FACT_GUARD: readonly RegExp[] = [
  /\bmismatch\b/i,
  /\bdoes not (?:match|connect|register)\b/i,
  /\bnot registered\b/i,
  /\bchanged the\b/i,
  /\bsubstituted\b/i,
  /\bunexpected (?:exchange|executor)\b/i,
  /\bunrequested fee\b/i,
  /\bproof\b/i,
  /\bhash\b/i,
  /\bsignature\b/i,
  /\bcalldata\b/i,
  /\bunsafe configuration\b/i,
  /\bchain id\b/i,
  /\bverif(?:y|ied|ication)\b/i,
  /\bprice anchor\b/i,
  // The two Multiply call builders refuse a quote the price anchor did not
  // pass with these exact words (#646); the refusal is a security check.
  /^Invalid (?:Multiply|unwind) route$/,
];

/**
 * The terminal's own plumbing messages, each with the reason it states nothing
 * a reader needs. Exact match only, and applied only to the terminal's own
 * `WalletError`: a connected wallet's text is never rewritten, even when it
 * reads the same (issue 652 review, F7). Adding a line hides a message, so it
 * needs the same review the list had. A message with a fact in it is never
 * listed (checked against `FACT_GUARD`); when in doubt it stays visible.
 */
const REVIEWED_PLUMBING: ReadonlyMap<string, string> = new Map([
  // Quote and resolve transport: the screen's own sentence says what failed.
  ["Could not quote Vesu wind route", "quote transport"],
  ["Could not quote Vesu unwind route", "quote transport"],
  ["Could not resolve Vesu pool", "pool lookup transport"],
  ["Vesu pool request failed", "pool lookup transport"],
  ["Vesu vToken not resolved for asset", "pool lookup transport"],
  ["No RPC endpoints configured", "configuration constant"],
  // Response shape parses of a quote or pool answer.
  ["Invalid AVNU build response", "response parse"],
  ["Invalid AVNU quote response", "response parse"],
  ["Invalid Ekubo quote response", "response parse"],
  ["Invalid Ekubo pool price response", "response parse"],
  ["Invalid Ekubo unwind route", "response parse"],
  ["Invalid Ekubo unwind route values", "response parse"],
  ["Invalid Ekubo unwind node", "response parse"],
  ["Invalid Ekubo unwind split", "response parse"],
  ["Empty Ekubo unwind route", "response parse"],
  // Input guards on values the screens pre-validate.
  ["Invalid AVNU sell amount", "amount is pre-validated on the screen"],
  ["Invalid AVNU sell token", "token comes from the screen's list"],
  ["Invalid AVNU swap token", "token comes from the screen's list"],
  ["Invalid AVNU slippage", "slippage comes from a fixed control"],
  ["Invalid AVNU taker address", "address is the connected account"],
  ["Invalid Ekubo buy token", "token comes from the screen's list"],
  ["Invalid Ekubo sell token", "token comes from the screen's list"],
  ["Invalid Ekubo swap token", "token comes from the screen's list"],
  ["Invalid Ekubo sell amount", "amount is pre-validated on the screen"],
  ["Invalid Ekubo taker address", "address is the connected account"],
  ["Invalid Multiply margin", "margin is pre-validated on the screen"],
  ["Invalid Vesu account address", "address is the connected account"],
  ["Invalid Vesu amount", "amount is pre-validated on the screen"],
  ["Invalid Vesu asset", "asset comes from the screen's list"],
  ["Invalid Vesu collateral asset", "asset comes from the screen's list"],
  ["Invalid Vesu collateral amount", "amount is pre-validated on the screen"],
  ["Invalid Vesu pool id", "pool id comes from the registry"],
  ["Invalid Vesu redemption id", "id comes from the position list"],
  ["Invalid Vesu borrow address", "address is the connected account"],
  ["Invalid Vesu repay address", "address is the connected account"],
  ["Invalid Vesu supply address", "address is the connected account"],
  ["Invalid Vesu withdraw address", "address is the connected account"],
  ["Invalid Vesu wind request", "request built by the screen"],
  ["Invalid Vesu unwind request", "request built by the screen"],
  ["Vesu collateral amount must be a u256", "amount is pre-validated on the screen"],
  ["Vesu vault amount must be a positive u256", "amount is pre-validated on the screen"],
  ["Vesu redeem shares must be a positive u256", "shares come from the position"],
  ["Vesu borrow/repay requires a collateral asset", "layer guard"],
  ["Unsupported Vesu lending action", "action comes from a fixed control"],
  // Layer guards no reader action reaches.
  ["Vesu buildLendingCalls needs a lending quote", "layer guard"],
  ["Ekubo buildSwapCalls needs an Ekubo route", "layer guard"],
  ["Wallet did not authorize an account.", "connect returned no account; the screen says it failed"],
  ["Could not resolve the connected account.", "connect returned no account; the screen says it failed"],
]);

/** Whether a message is a security or cryptographic fact (see `FACT_GUARD`). */
export const isFactMessage = (message: string): boolean =>
  FACT_GUARD.some((pattern) => pattern.test(message));

/**
 * Whether the terminal's own error is reviewed plumbing that collapses to the
 * screen's fallback. Exact match against `REVIEWED_PLUMBING`; a fact is never
 * plumbing.
 */
export const isInternalMessage = (message: string): boolean =>
  REVIEWED_PLUMBING.has(message) && !isFactMessage(message);

/** Every reviewed plumbing message, for the conformance test. */
export const reviewedPlumbing = (): readonly string[] => [...REVIEWED_PLUMBING.keys()];

/**
 * The sentence a screen shows for a caught error. `fallback` is the screen's
 * existing sentence for an unknown failure; it is returned for a non-Error, an
 * empty message, transport detail, and the terminal's own plumbing.
 */
export const userErrorMessage = (cause: unknown, fallback: string): string => {
  if (!(cause instanceof Error)) return fallback;
  const message = cause.message.trim();
  if (message === "") return fallback;
  const reviewed = REVIEWED_COPY.get(message);
  if (reviewed !== undefined) return reviewed;
  if (TRANSPORT_ERROR_NAMES.has(cause.name)) return fallback;
  return cause instanceof WalletError && isInternalMessage(message) ? fallback : message;
};
