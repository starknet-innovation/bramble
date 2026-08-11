/**
 * Checks the user-facing minimum for a local vault encryption passphrase.
 * This validates only the value shape; custody and encryption stay in vault.
 */
export const isVaultPassphrase = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length >= 12;
