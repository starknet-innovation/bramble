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
