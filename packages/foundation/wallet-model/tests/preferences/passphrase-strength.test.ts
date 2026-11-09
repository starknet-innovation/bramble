/**
 * The setup meter's strength estimate is feedback that tracks the typed text
 * monotonically and never reads as acceptable before the validator does. Above
 * the length floor it bands on estimated entropy alone, so a short varied
 * passphrase is reported as what it is instead of being forced to read weak.
 */
import { describe, expect, test } from "bun:test";
import {
  isVaultPassphrase,
  MIN_VAULT_PASSPHRASE_LENGTH,
  RECOMMENDED_VAULT_PASSPHRASE_LENGTH,
} from "@bramble/wallet-model/passphrase";
import { estimatePassphraseStrength } from "@bramble/wallet-model/passphrase-strength";

describe("estimatePassphraseStrength", () => {
  test("is empty for no input and weak below the minimum length", () => {
    expect(estimatePassphraseStrength("")).toEqual({
      hint: `Enter at least ${MIN_VAULT_PASSPHRASE_LENGTH} characters`,
      level: "empty",
      ratio: 0,
    });
    const tooShort = "aB3$".repeat(1);
    expect(tooShort.length).toBeLessThan(MIN_VAULT_PASSPHRASE_LENGTH);
    const short = estimatePassphraseStrength(tooShort);
    expect(short.level).toBe("weak");
    expect(short.ratio).toBeLessThanOrEqual(0.4);
    expect(short.hint).toBe(`Enter at least ${MIN_VAULT_PASSPHRASE_LENGTH} characters`);
    expect(isVaultPassphrase(tooShort)).toBe(false);
  });

  test("does not force a short varied passphrase to read weak on length alone", () => {
    // The length floor is a worse predictor than the entropy estimate: an
    // 11-character mixed-class value estimates stronger than a 12-character
    // run of one letter. The validator accepts both; the meter is what
    // distinguishes them, and it says so rather than being clamped by length.
    const short = "Tr0ub4dor&3";
    expect(short.length).toBeLessThan(RECOMMENDED_VAULT_PASSPHRASE_LENGTH);
    expect(short.length).toBeGreaterThanOrEqual(MIN_VAULT_PASSPHRASE_LENGTH);
    expect(isVaultPassphrase(short)).toBe(true);
    expect(estimatePassphraseStrength(short).level).toBe("strong");
    expect(estimatePassphraseStrength("aaaaaaaaaaaa").level).toBe("weak");
  });

  test("names the band it reached and nothing else", () => {
    // The hint is the band. Length advice used to ride along with it, which put
    // a third sentence on a screen whose bar already showed the same thing;
    // accepting a short passphrase is still not blocked.
    expect(estimatePassphraseStrength("Tr0ub4dor&3").hint).toBe("Strong");
    expect(estimatePassphraseStrength("Tr0ub4dor&3xyz9!").hint).toBe("Strong");
    expect(estimatePassphraseStrength("correcthorse").hint).toBe("Fair");
    expect(estimatePassphraseStrength("aaaaaaaaaaaa").hint).toBe("Weak");
  });

  test("bands a valid passphrase by estimated entropy", () => {
    expect(estimatePassphraseStrength("aaaaaaaaaaaa").level).toBe("weak");
    expect(estimatePassphraseStrength("correcthorse").level).toBe("fair");
    expect(estimatePassphraseStrength("correct horse battery staple").level).toBe("strong");
    expect(estimatePassphraseStrength("Tr0ub4dor&3xyz9!").level).toBe("strong");
  });

  test("fills the bar monotonically as characters are added", () => {
    const text = "Bramble keeps the keys!";
    let previous = 0;
    for (let length = 1; length <= text.length; length += 1) {
      const { ratio } = estimatePassphraseStrength(text.slice(0, length));
      expect(ratio).toBeGreaterThanOrEqual(previous);
      expect(ratio).toBeLessThanOrEqual(1);
      previous = ratio;
    }
    expect(previous).toBe(1);
  });

  test("still bands an acceptable but poor passphrase as weak", () => {
    // Onboarding asks for no acknowledgement any more, so the meter is the only
    // thing that tells someone their accepted passphrase is a poor one. A value
    // that clears the floor and nothing else must still read weak, and a varied
    // one of the same length must not.
    expect(isVaultPassphrase("aaaaaaaaaaaa")).toBe(true);
    expect(estimatePassphraseStrength("aaaaaaaaaaaa").level).toBe("weak");
    expect(estimatePassphraseStrength("Tr0ub4dor&3").level).not.toBe("weak");
    expect(estimatePassphraseStrength("correct horse battery staple").level).not.toBe("weak");
  });

  test("reads a common password in disguise as weak (Sherlock 152)", () => {
    // Each of these cleared the floor and estimated fair or strong, because
    // the estimate credits every character as random. A guesser tries them
    // first: case, leet, a year or trailing symbols do not hide the word.
    for (const value of [
      "Password1",
      "p@ssw0rd2024",
      "dragon!!!",
      "iloveyou2024",
      "Passw0rd!Passw0rd!",
      "zxcvbnm123!",
      "Lkjhgfdsa2024",
      "1ceman2024!",
      "123password!",
      "1etmein!!",
    ]) {
      expect(isVaultPassphrase(value)).toBe(true);
      const reading = estimatePassphraseStrength(value);
      expect(reading).toEqual({ hint: "Weak", level: "weak", ratio: reading.ratio });
      expect(reading.ratio).toBeLessThanOrEqual(0.4);
    }
  });

  test("leaves random words and random characters where they were", () => {
    expect(estimatePassphraseStrength("plaza tundra mosaic velvet").level).toBe("strong");
    expect(estimatePassphraseStrength("k7#Qm2!vX9pL$w4z").level).toBe("strong");
    expect(estimatePassphraseStrength("correcthorse").level).toBe("fair");
  });
});
