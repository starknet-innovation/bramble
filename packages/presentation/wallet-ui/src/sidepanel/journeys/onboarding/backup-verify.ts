/**
 * Pure onboarding backup-verification predicate. When the user generates a
 * fresh recovery phrase we make them re-type a few words before the wallet can
 * be created, proving they actually recorded it.
 *
 * The checked positions are DETERMINISTIC (fixed, not random) on purpose:
 * randomness would require a clock/entropy boundary that the repo standards
 * keep out of pure UI code, and fixed positions keep this predicate pure and
 * exhaustively testable. Positions 3, 7, and 11 (1-indexed) are spread across
 * the start, middle, and end of a 12-word phrase so a partial transcription is
 * still caught.
 */

/**
 * One-indexed word positions the user must confirm after generating a phrase.
 */
export const BACKUP_VERIFY_POSITIONS = [3, 7, 11] as const;

const words = (phrase: string): readonly string[] => phrase.trim().split(/\s+/).filter(Boolean);

/**
 * Checks that every confirmation answer matches the phrase word at its
 * position. Answers are compared case-insensitively after trimming; a phrase
 * shorter than the highest checked position never verifies.
 */
export const verifyBackupWords = (phrase: string, answers: readonly string[]): boolean => {
  const phraseWords = words(phrase);
  if (phraseWords.length < Math.max(...BACKUP_VERIFY_POSITIONS)) {
    return false;
  }
  return BACKUP_VERIFY_POSITIONS.every((position, index) => {
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
 * Classifies the confirmation answers against the phrase. Pure; the phrase and
 * answers are only compared, never retained or returned.
 */
export const backupVerifyState = (
  phrase: string,
  answers: readonly string[],
): BackupVerifyState => {
  if (verifyBackupWords(phrase, answers)) {
    return "confirmed";
  }
  const complete = BACKUP_VERIFY_POSITIONS.every(
    (_, index) => (answers[index] ?? "").trim().length > 0,
  );
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
