/**
 * Backup-verification predicate checks: onboarding only lets a generated phrase
 * through when the deterministic confirmation words are re-typed correctly.
 */
import { describe, expect, test } from "bun:test";
import {
  BACKUP_VERIFY_COPY,
  BACKUP_VERIFY_POSITIONS,
  backupVerifyState,
  verifyBackupWords,
} from "../../../../src/sidepanel/journeys/onboarding/backup-verify";

const phrase = "habit hope tip crystal because grunt nation idea electric witness alert like";
const words = phrase.split(" ");
const correct = BACKUP_VERIFY_POSITIONS.map((position) => words[position - 1] ?? "");

describe("verifyBackupWords", () => {
  test("checks fixed, spread-out positions inside a 12-word phrase", () => {
    expect(BACKUP_VERIFY_POSITIONS).toEqual([3, 7, 11]);
    expect(correct).toEqual(["tip", "nation", "alert"]);
  });

  test("accepts the exact confirmation words", () => {
    expect(verifyBackupWords(phrase, correct)).toBe(true);
  });

  test("is case- and whitespace-insensitive", () => {
    expect(verifyBackupWords(phrase, ["  TIP ", "Nation", "alert  "])).toBe(true);
    expect(verifyBackupWords(`  ${phrase}  `, correct)).toBe(true);
  });

  test("rejects any wrong or missing word", () => {
    expect(verifyBackupWords(phrase, ["tip", "nation", "wrong"])).toBe(false);
    expect(verifyBackupWords(phrase, ["tip", "nation", ""])).toBe(false);
    expect(verifyBackupWords(phrase, ["tip", "nation"])).toBe(false);
    expect(verifyBackupWords(phrase, [])).toBe(false);
  });

  test("rejects phrases too short to contain every checked position", () => {
    expect(verifyBackupWords("only three words here", ["", "", ""])).toBe(false);
    expect(verifyBackupWords("", correct)).toBe(false);
  });

  test("does not match a blank answer against a missing word", () => {
    expect(verifyBackupWords("one two", ["", "", ""])).toBe(false);
  });
});

describe("backupVerifyState", () => {
  // Positional placeholders, not recovery words: the classifier only compares
  // answers against the words at the requested positions.
  const placeholder = Array.from({ length: 12 }, (_, index) => `w${index + 1}`).join(" ");
  const matching = BACKUP_VERIFY_POSITIONS.map((position) => `w${position}`);

  test("confirms exactly when verifyBackupWords does", () => {
    expect(backupVerifyState(placeholder, matching)).toBe("confirmed");
    expect(backupVerifyState(placeholder, [" W3 ", "w7", "W11"])).toBe("confirmed");
  });

  test("is incomplete while any requested word is blank", () => {
    expect(backupVerifyState(placeholder, [])).toBe("incomplete");
    expect(backupVerifyState(placeholder, ["w3", "", "w11"])).toBe("incomplete");
    expect(backupVerifyState(placeholder, ["w3", "   ", "w11"])).toBe("incomplete");
    expect(backupVerifyState(placeholder, ["nope", "nope"])).toBe("incomplete");
  });

  test("is a mismatch once every word is entered and any differs", () => {
    expect(backupVerifyState(placeholder, ["w3", "w7", "w12"])).toBe("mismatch");
    expect(backupVerifyState(placeholder, ["w7", "w3", "w11"])).toBe("mismatch");
    // A phrase too short to check never confirms, however complete the answers.
    expect(backupVerifyState("w1 w2", matching)).toBe("mismatch");
  });

  test("tells a wrong word apart from an empty form", () => {
    expect(BACKUP_VERIFY_COPY.mismatch).not.toBe(BACKUP_VERIFY_COPY.incomplete);
    expect(BACKUP_VERIFY_COPY.confirmed).toBe("Backup confirmed.");
    // The copy never echoes or points at a word.
    for (const copy of Object.values(BACKUP_VERIFY_COPY)) {
      expect(copy).not.toMatch(/\bw\d+\b|word [0-9]/i);
    }
  });
});
