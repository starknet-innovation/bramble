/**
 * Maximum accepted vault passphrase length at message and KDF boundaries.
 */
export const MAX_VAULT_PASSPHRASE_LENGTH = 1_024;

/**
 * Maximum accepted recovery-phrase text length at untrusted boundaries.
 * The KMS remains responsible for validating the phrase itself.
 */
export const MAX_MNEMONIC_LENGTH = 512;

/**
 * Maximum accepted optional BIP-39 passphrase length at untrusted boundaries.
 */
export const MAX_MNEMONIC_PASSPHRASE_LENGTH = 1_024;

/**
 * Validates bounded, non-empty mnemonic text before KMS work begins.
 * This is a resource bound, not a mnemonic-validity decision.
 */
export const isMnemonicText = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_MNEMONIC_LENGTH && value.trim().length > 0;

/**
 * Validates the optional bounded BIP-39 passphrase supplied to derivation.
 */
export const isMnemonicPassphrase = (value: unknown): value is string | undefined =>
  value === undefined ||
  (typeof value === "string" && value.length <= MAX_MNEMONIC_PASSPHRASE_LENGTH);

/**
 * Checks the user-facing bounds for a local vault encryption passphrase.
 * This validates only the value shape; custody and encryption stay in vault.
 */
export const isVaultPassphrase = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= MAX_VAULT_PASSPHRASE_LENGTH &&
  value.trim().length >= 12;
