/**
 * BIP39 English assist helpers used by recovery-phrase entry.
 */
import { describe, expect, test } from "bun:test";
import { isBip39EnglishWord, suggestBip39EnglishWords } from "../../src/recovery/bip39-english";

describe("bip39 english assist", () => {
  test("recognizes English BIP39 words case-insensitively", () => {
    expect(isBip39EnglishWord("abandon")).toBe(true);
    expect(isBip39EnglishWord(" Zoo ")).toBe(true);
    expect(isBip39EnglishWord("notaword")).toBe(false);
    expect(isBip39EnglishWord("")).toBe(false);
  });

  test("suggests prefix completions without treating membership as checksum validation", () => {
    expect(suggestBip39EnglishWords("")).toEqual([]);
    expect(suggestBip39EnglishWords("zzzz")).toEqual([]);
    expect(suggestBip39EnglishWords("abo")).toEqual(["about", "above"]);
    expect(suggestBip39EnglishWords("ab", 3)).toEqual(["abandon", "ability", "able"]);
  });
});
