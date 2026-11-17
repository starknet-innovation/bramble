/**
 * Pure onboarding backup-verification predicate. When the user generates a
 * fresh recovery phrase we make them re-type a few words before the wallet can
 * be created, proving they actually recorded it.
 *
 * Which words are asked varies per wallet: {@link backupVerifyPositions} maps a
 * caller-supplied `variation` onto one position per band of the phrase, so
 * someone who creates a second wallet is not asked the three words the first
 * one taught them, while a transcription that stopped early or skipped the
 * middle is still caught. That number arrives as an argument rather than being
 * read here — the repo standards keep clock and entropy access in explicit
 * boundary modules, and injecting it keeps every predicate below pure and
 * exhaustively testable. The phrase is never an input to the choice: what the
 * screen shows must not be a function of the secret it is checking.
 */

/** How many words of a freshly generated phrase the user confirms. */
export const BACKUP_VERIFY_COUNT = 3;

/**
 * The 1-indexed word positions to confirm for a phrase of `wordCount` words,
 * one drawn from each equal band of it. `variation` only has to differ between
 * wallets — it is not key material and never reaches the vault — and the same
 * value always yields the same positions, so a fixture or test can pin an exact
 * set. A phrase too short to band yields no positions, which
 * {@link verifyBackupWords} refuses rather than vacuously accepting.
 */
export const backupVerifyPositions = (wordCount: number, variation: number): readonly number[] => {
  const band = Math.floor(wordCount / BACKUP_VERIFY_COUNT);
  if (band < 1) {
    return [];
  }
  const spread = Number.isFinite(variation) ? Math.trunc(Math.abs(variation)) : 0;
  return Array.from({ length: BACKUP_VERIFY_COUNT }, (_, index) => {
    const offset = Math.floor(spread / band ** index) % band;
    return index * band + offset + 1;
  });
};

/**
 * The positions a surface renders before any phrase exists, and the set a
 * caller with no variation of its own gets. Spread across a 12-word phrase.
 */
export const DEFAULT_BACKUP_VERIFY_POSITIONS = backupVerifyPositions(12, 0);

const words = (phrase: string): readonly string[] => phrase.trim().split(/\s+/).filter(Boolean);

/**
 * Checks that every confirmation answer matches the phrase word at its
 * position. Answers are compared case-insensitively after trimming; a phrase
 * shorter than the highest checked position, and an empty position list, never
 * verify.
 */
export const verifyBackupWords = (
  phrase: string,
  answers: readonly string[],
  positions: readonly number[],
): boolean => {
  const phraseWords = words(phrase);
  if (positions.length === 0 || phraseWords.length < Math.max(...positions)) {
    return false;
  }
  return positions.every((position, index) => {
    const expected = phraseWords[position - 1];
    const answer = (answers[index] ?? "").trim().toLowerCase();
    return answer.length > 0 && answer === expected?.toLowerCase();
  });
};

/**
 * Where the confirmation stands: `incomplete` while any requested word is
 * blank, `mismatch` once every word is entered but they do not all match,
 * `confirmed` when {@link verifyBackupWords} passes. It adds no check of its
 * own and never says which word differs.
 */
export type BackupVerifyState = "confirmed" | "incomplete" | "mismatch";

/**
 * Classifies the confirmation answers against the phrase at `positions`. Pure;
 * the phrase and answers are only compared, never retained or returned.
 */
export const backupVerifyState = (
  phrase: string,
  answers: readonly string[],
  positions: readonly number[],
): BackupVerifyState => {
  if (verifyBackupWords(phrase, answers, positions)) {
    return "confirmed";
  }
  const complete =
    positions.length > 0 && positions.every((_, index) => (answers[index] ?? "").trim().length > 0);
  return complete ? "mismatch" : "incomplete";
};

/**
 * Status line under the confirmation fields for each state. A mismatch is
 * reported as such, so a mistyped word reads as an error to fix rather than
 * as the same prompt shown to an empty form.
 */
export const BACKUP_VERIFY_COPY: Readonly<Record<BackupVerifyState, string>> = {
  confirmed: "Backup confirmed.",
  incomplete: "Enter the requested words to continue.",
  mismatch: "These words don't match your recovery phrase. Check your copy.",
};
