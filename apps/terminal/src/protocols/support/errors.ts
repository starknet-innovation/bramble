/**
 * Small error helper for fail-closed domain checks.
 */
export class WalletError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WalletError";
  }
}
