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
 * A refusal raised before the operation that throws it has written anything
 * durable, so the state is exactly as it was. A guard that locks the session on
 * any failure, because a storage failure leaves the outcome ambiguous, may
 * treat this one as unambiguous and only undo its own earlier writes.
 */
export class RefusedBeforeWrite extends WalletError {
  public constructor(message: string) {
    super(message);
    this.name = "RefusedBeforeWrite";
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
