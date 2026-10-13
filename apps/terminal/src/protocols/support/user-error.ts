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
 * 4. `INTERNAL_FAMILIES`: the terminal's own plumbing diagnostics collapse to
 *    the sink's existing fallback sentence.
 * 5. Anything else passes through unchanged: the screens' own sentences, and
 *    errors raised by the connected wallet or a Ledger behind it, which the
 *    terminal does not own and must not reword.
 *
 * Pure: no DOM, clock, or network access. It never invents copy — a collapsed
 * message becomes the fallback the calling screen already showed.
 */

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

/** The terminal's own plumbing diagnostics. Never shown as written. */
const INTERNAL_FAMILIES: readonly RegExp[] = [
  /^Invalid [A-Za-z]/,
  /^Could not (?:quote|resolve)\b/,
  /^Empty Ekubo\b/,
  /^(?:Ekubo|AVNU|Starkscan) returned (?:no|invalid)\b/,
  /^(?:AVNU|Vesu) (?:quote |build |pool )?request failed\.?$/,
  /\breturned (?:an )?invalid\b/,
  /\bis invalid\.$/,
  /\bmust be a (?:positive )?u256$/,
  /^No RPC endpoints configured$/,
  /^Wallet did not authorize an account\.$/,
  /^The terminal refused an empty wallet request\.$/,
  /^Missing private swap invocation\.$/,
  /^Vesu vToken not resolved\b/,
  /^Vesu borrow\/repay requires\b/,
  /^Unsupported Vesu\b/,
  // A source identifier ("buildSwapCalls") is never reader copy.
  /\bbuild[A-Z]\w*\b/,
];

const matchesAny = (patterns: readonly RegExp[], message: string): boolean =>
  patterns.some((pattern) => pattern.test(message));

/** Whether a message states a security or cryptographic fact (see `FACT_GUARD`). */
export const isFactMessage = (message: string): boolean => matchesAny(FACT_GUARD, message);

/** Whether a message is terminal plumbing that collapses to the sink's fallback. */
export const isInternalMessage = (message: string): boolean =>
  !isFactMessage(message) && matchesAny(INTERNAL_FAMILIES, message);

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
  return isInternalMessage(message) ? fallback : message;
};
