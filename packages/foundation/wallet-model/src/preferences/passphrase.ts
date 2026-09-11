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

/**
 * Coarse strength band for the passphrase meter shown while a vault
 * passphrase is typed. `"weak"` also covers anything under the 12-character
 * minimum, so the meter never reads as acceptable before the validator does.
 */
export type PassphraseStrengthLevel = "empty" | "weak" | "fair" | "strong";

/**
 * Meter reading for a passphrase in progress: the band, the share of the bar
 * to fill (0–1, monotonic in the estimate), and one short line of guidance.
 */
export type PassphraseStrength = {
  readonly level: PassphraseStrengthLevel;
  readonly ratio: number;
  readonly hint: string;
};

const STRONG_BITS = 72;
const FAIR_BITS = 48;

// Alphabet sizes behind each character class the estimate credits.
const classSize = (value: string): number => {
  let size = 0;
  if (/[a-z]/.test(value)) size += 26;
  if (/[A-Z]/.test(value)) size += 26;
  if (/[0-9]/.test(value)) size += 10;
  if (/[^a-zA-Z0-9]/.test(value)) size += 33;
  return size;
};

/**
 * Estimates how hard a vault passphrase is to guess, for the setup meter only.
 * It is feedback, never a gate: acceptance stays with {@link isVaultPassphrase}.
 *
 * The estimate is length times the entropy per character of the classes
 * used, damped by how repetitive the text is (a run of one character earns
 * almost nothing), banded as weak / fair / strong. It has no clock, network,
 * or secret handling, and never keeps the value.
 */
export const estimatePassphraseStrength = (value: string): PassphraseStrength => {
  if (value.length === 0) {
    return { hint: "Enter at least 12 characters", level: "empty", ratio: 0 };
  }
  const unique = new Set(value).size;
  const repetition = Math.min(1, (unique + 4) / Math.min(value.length, 16));
  const bits = value.length * Math.log2(Math.max(classSize(value), 2)) * repetition;
  const ratio = Math.min(1, Math.max(0.08, bits / STRONG_BITS));
  if (!isVaultPassphrase(value)) {
    return { hint: "Enter at least 12 characters", level: "weak", ratio: Math.min(ratio, 0.4) };
  }
  if (bits >= STRONG_BITS) {
    return { hint: "Strong passphrase", level: "strong", ratio: 1 };
  }
  if (bits >= FAIR_BITS) {
    return { hint: "Fair — longer, or mix in numbers and symbols", level: "fair", ratio };
  }
  return { hint: "Weak — use more varied characters", level: "weak", ratio };
};
