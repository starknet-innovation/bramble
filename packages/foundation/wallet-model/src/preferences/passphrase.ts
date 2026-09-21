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

/**
 * Coarse strength band for the passphrase meter shown while a vault
 * passphrase is typed. `"weak"` also covers anything under
 * {@link MIN_VAULT_PASSPHRASE_LENGTH}, so the meter never reads as acceptable
 * before the validator does. Above that floor the band follows the entropy
 * estimate alone — a short varied passphrase is reported as what it is, rather
 * than being forced to read weak on length.
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
  const tooShortHint = `Enter at least ${MIN_VAULT_PASSPHRASE_LENGTH} characters`;
  if (value.length === 0) {
    return { hint: tooShortHint, level: "empty", ratio: 0 };
  }
  const unique = new Set(value).size;
  const repetition = Math.min(1, (unique + 4) / Math.min(value.length, 16));
  const bits = value.length * Math.log2(Math.max(classSize(value), 2)) * repetition;
  const ratio = Math.min(1, Math.max(0.08, bits / STRONG_BITS));
  if (!isVaultPassphrase(value)) {
    return { hint: tooShortHint, level: "weak", ratio: Math.min(ratio, 0.4) };
  }
  // Accepted, but shorter than we would advise: say so without blocking. The
  // band still comes from the entropy estimate, so this never contradicts it.
  const short = value.trim().length < RECOMMENDED_VAULT_PASSPHRASE_LENGTH;
  const longerHint = `${RECOMMENDED_VAULT_PASSPHRASE_LENGTH}+ characters is safer`;
  if (bits >= STRONG_BITS) {
    return {
      hint: short ? `Strong — ${longerHint}` : "Strong passphrase",
      level: "strong",
      ratio: 1,
    };
  }
  if (bits >= FAIR_BITS) {
    return {
      hint: short ? `Fair — ${longerHint}` : "Fair — longer, or mix in numbers and symbols",
      level: "fair",
      ratio,
    };
  }
  return { hint: "Weak — use more characters, or more varied ones", level: "weak", ratio };
};

/**
 * Whether a passphrase is accepted but weak enough that the user should say so
 * deliberately before it protects a vault. Lowering the length floor means a
 * genuinely poor passphrase can now clear the validator, so the speed bump
 * moves from the validator to an explicit acknowledgement: nothing is refused,
 * but nothing poor is accepted silently either.
 *
 * False for a value that is not acceptable at all — that case is already
 * blocked, and asking someone to acknowledge a passphrase they cannot use
 * would be nonsense.
 */
export const requiresWeakPassphraseAcknowledgement = (value: string): boolean =>
  isVaultPassphrase(value) && estimatePassphraseStrength(value).level === "weak";
