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
