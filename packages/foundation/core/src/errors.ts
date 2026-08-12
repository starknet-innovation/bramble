/**
 * Small error helper for fail-closed domain checks.
 */
export class WalletError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WalletError";
  }
}

/**
 * Throws a wallet error when an internal invariant is violated.
 */
export const invariant = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new WalletError(message);
  }
};

/**
 * Extracts a stable, user-facing message from a caught error. A `WalletError`
 * carries a curated message safe to surface across the dapp boundary (a device
 * rejection, a locked wallet); anything else collapses to the caller's generic
 * fallback so internal detail never leaks. Used by the held-approval executors
 * to turn a thrown sign/submit failure into a returned `{ error }` response.
 */
export const walletErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof WalletError ? error.message : fallback;

/** Longest diagnostic kept; a node can reject with a very large payload. */
const MAX_DETAIL_LENGTH = 600;

/**
 * Extracts the caught error's own text as a diagnostic for the **wallet's own
 * surfaces only** — the panel's status line and its copy-for-a-bug-report
 * control. This is the counterpart to {@link walletErrorMessage}: that function
 * deliberately collapses an uncurated error to a generic message so internal
 * detail never crosses the dapp boundary, which also threw away the one thing a
 * user needs to understand a rejected transaction (the node's reason).
 *
 * Callers must keep the two apart: send {@link walletErrorMessage} to the page
 * and this only to the extension's own UI. Never persist or log the result.
 *
 * Returns `null` when there is nothing to add — no message, or text identical to
 * the curated `summary` — so callers can omit the field rather than repeat
 * themselves. Output is trimmed and truncated to a bounded length.
 */
export const errorDetail = (error: unknown, summary: string): string | null => {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === summary) {
    return null;
  }
  return trimmed.length > MAX_DETAIL_LENGTH ? `${trimmed.slice(0, MAX_DETAIL_LENGTH)}…` : trimmed;
};
