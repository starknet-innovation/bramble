/**
 * Backup-verification predicate checks: onboarding only lets a generated phrase
 * through when the requested confirmation words are re-typed correctly, and the
 * positions it requests vary with the variation it is given while staying spread
 * across the phrase.
 */
import { describe, expect, test } from "bun:test";
import {
  BACKUP_VERIFY_COPY,
  BACKUP_VERIFY_COUNT,
  backupVerifyPositions,
  backupVerifyState,
  DEFAULT_BACKUP_VERIFY_POSITIONS,
  verifyBackupWords,
} from "../../../../src/sidepanel/journeys/onboarding/backup-verify";

const phrase = "habit hope tip crystal because grunt nation idea electric witness alert like";
const words = phrase.split(" ");
const positions = backupVerifyPositions(12, 2 + 4 * 2 + 16 * 2);
const correct = positions.map((position) => words[position - 1] ?? "");

describe("backupVerifyPositions", () => {
  test("draws one position from each band of the phrase", () => {
    // Bands of four for a 12-word phrase: the variation's base-4 digits choose the
    // offset inside each, so an early, a middle, and a late word are always
    // asked however it falls.
    expect(positions).toEqual([3, 7, 11]);
    expect(correct).toEqual(["tip", "nation", "alert"]);
    expect(backupVerifyPositions(24, 0)).toEqual([1, 9, 17]);
    expect(backupVerifyPositions(24, 7 + 8 * 7 + 64 * 7)).toEqual([8, 16, 24]);
  });

  test("asks a different set as the variation moves, and the same set for one value", () => {
    const sets = new Set(
      Array.from({ length: 64 }, (_, variation) => backupVerifyPositions(12, variation).join()),
    );
    expect(sets.size).toBe(64);
    expect(backupVerifyPositions(12, 41)).toEqual(backupVerifyPositions(12, 41));
  });

  test("stays inside the phrase for any variation", () => {
    for (let variation = 0; variation < 200; variation += 1) {
      const chosen = backupVerifyPositions(12, variation);
      expect(chosen).toHaveLength(BACKUP_VERIFY_COUNT);
      expect(chosen.every((position) => position >= 1 && position <= 12)).toBe(true);
      expect([...chosen].sort((left, right) => left - right)).toEqual([...chosen]);
    }
  });

  test("yields nothing for a phrase too short to band, and tolerates a junk variation", () => {
    expect(backupVerifyPositions(2, 0)).toEqual([]);
    expect(backupVerifyPositions(0, 5)).toEqual([]);
    expect(backupVerifyPositions(12, Number.NaN)).toEqual(DEFAULT_BACKUP_VERIFY_POSITIONS);
    expect(backupVerifyPositions(12, -0.5)).toEqual(DEFAULT_BACKUP_VERIFY_POSITIONS);
    expect(DEFAULT_BACKUP_VERIFY_POSITIONS).toEqual([1, 5, 9]);
  });
});

describe("verifyBackupWords", () => {
  test("accepts the exact confirmation words", () => {
    expect(verifyBackupWords(phrase, correct, positions)).toBe(true);
  });

  test("is case- and whitespace-insensitive", () => {
    expect(verifyBackupWords(phrase, ["  TIP ", "Nation", "alert  "], positions)).toBe(true);
    expect(verifyBackupWords(`  ${phrase}  `, correct, positions)).toBe(true);
  });

  test("rejects any wrong or missing word", () => {
    expect(verifyBackupWords(phrase, ["tip", "nation", "wrong"], positions)).toBe(false);
    expect(verifyBackupWords(phrase, ["tip", "nation", ""], positions)).toBe(false);
    expect(verifyBackupWords(phrase, ["tip", "nation"], positions)).toBe(false);
    expect(verifyBackupWords(phrase, [], positions)).toBe(false);
  });

  test("rejects phrases too short to contain every checked position", () => {
    expect(verifyBackupWords("only three words here", ["", "", ""], positions)).toBe(false);
    expect(verifyBackupWords("", correct, positions)).toBe(false);
  });

  test("does not match a blank answer against a missing word", () => {
    expect(verifyBackupWords("one two", ["", "", ""], positions)).toBe(false);
  });

  test("refuses an empty position list rather than vacuously confirming it", () => {
    // `every` over no positions is true, so a phrase too short to band would
    // otherwise confirm itself with no words typed at all.
    expect(verifyBackupWords(phrase, [], [])).toBe(false);
    expect(verifyBackupWords(phrase, correct, [])).toBe(false);
  });
});

describe("backupVerifyState", () => {
  // Positional placeholders, not recovery words: the classifier only compares
  // answers against the words at the requested positions.
  const placeholder = Array.from({ length: 12 }, (_, index) => `w${index + 1}`).join(" ");
  const matching = positions.map((position) => `w${position}`);

  test("confirms exactly when verifyBackupWords does", () => {
    expect(backupVerifyState(placeholder, matching, positions)).toBe("confirmed");
    expect(backupVerifyState(placeholder, [" W3 ", "w7", "W11"], positions)).toBe("confirmed");
  });

  test("is incomplete while any requested word is blank", () => {
    expect(backupVerifyState(placeholder, [], positions)).toBe("incomplete");
    expect(backupVerifyState(placeholder, ["w3", "", "w11"], positions)).toBe("incomplete");
    expect(backupVerifyState(placeholder, ["w3", "   ", "w11"], positions)).toBe("incomplete");
    expect(backupVerifyState(placeholder, ["nope", "nope"], positions)).toBe("incomplete");
    expect(backupVerifyState(placeholder, matching, [])).toBe("incomplete");
  });

  test("is a mismatch once every word is entered and any differs", () => {
    expect(backupVerifyState(placeholder, ["w3", "w7", "w12"], positions)).toBe("mismatch");
    expect(backupVerifyState(placeholder, ["w7", "w3", "w11"], positions)).toBe("mismatch");
    // A phrase too short to check never confirms, however complete the answers.
    expect(backupVerifyState("w1 w2", matching, positions)).toBe("mismatch");
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
