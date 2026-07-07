/**
 * Backup-verification predicate checks: onboarding only lets a generated phrase
 * through when the deterministic confirmation words are re-typed correctly.
 */
import { describe, expect, test } from "bun:test";
import { BACKUP_VERIFY_POSITIONS, verifyBackupWords } from "../src/sidepanel/backup-verify";

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
