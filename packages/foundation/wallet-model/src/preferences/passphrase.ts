/**
 * Length bounds for vault and recovery secrets. Pure policy: no value is
 * stored or sent anywhere. The setup meter's strength estimate lives in
 * `passphrase-strength.ts`, so the background, which imports these bounds,
 * does not carry the meter's word list.
 */
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
 * Shortest accepted vault passphrase. Single-sourced because the same floor is
 * enforced at the vault boundary, at the KDF, and on every credential field —
 * including the unlock and reveal re-auth fields, which must never refuse a
 * passphrase the setup screen allowed a user to choose.
 *
 * Eight matches the floor users already meet in other wallets. It is a floor,
 * not a recommendation: what actually resists an offline attack is the KDF cost
 * (PBKDF2-SHA-256, 600k iterations) together with how much entropy the value
 * carries, which {@link estimatePassphraseStrength} reports as the user types.
 */
export const MIN_VAULT_PASSPHRASE_LENGTH = 8;

/**
 * Length at or above which the meter stops advising a longer passphrase.
 * Advisory only — never a gate. A shorter value with varied characters can
 * estimate stronger than a longer repetitive one, so the meter bands by
 * entropy and mentions length only as the cheapest way to add more.
 */
export const RECOMMENDED_VAULT_PASSPHRASE_LENGTH = 12;

/**
 * Checks the user-facing bounds for a local vault encryption passphrase.
 * This validates only the value shape; custody and encryption stay in vault.
 */
export const isVaultPassphrase = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= MAX_VAULT_PASSPHRASE_LENGTH &&
  value.trim().length >= MIN_VAULT_PASSPHRASE_LENGTH;
