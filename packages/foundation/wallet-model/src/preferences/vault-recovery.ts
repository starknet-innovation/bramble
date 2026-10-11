/**
 * Why a stored vault cannot be unlocked normally, as the background reports it
 * to the side panel. Single-sourced here because the vault service decides it,
 * the wire status carries it, and the panel validates it before choosing the
 * screen to show.
 */

const VAULT_RECOVERY_REASONS = ["invalid", "rollback", "unverified"] as const;

/**
 * `unverified` when no record vouches for the vault, `rollback` when a record
 * names a newer copy, `invalid` when the stored data is malformed. The first
 * two can be recovered with the passphrase; `invalid` cannot be decrypted.
 */
export type VaultRecovery = (typeof VAULT_RECOVERY_REASONS)[number];

/** Validates an untrusted recovery reason. */
export const isVaultRecovery = (value: unknown): value is VaultRecovery =>
  typeof value === "string" && (VAULT_RECOVERY_REASONS as readonly string[]).includes(value);
