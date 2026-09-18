/**
 * The setup meter's strength estimate is feedback that tracks the typed text
 * monotonically and never reads as acceptable before the validator does. Above
 * the length floor it bands on estimated entropy alone, so a short varied
 * passphrase is reported as what it is instead of being forced to read weak.
 */
import { describe, expect, test } from "bun:test";
import {
  estimatePassphraseStrength,
  isVaultPassphrase,
  MIN_VAULT_PASSPHRASE_LENGTH,
  RECOMMENDED_VAULT_PASSPHRASE_LENGTH,
  requiresWeakPassphraseAcknowledgement,
} from "@bramble/wallet-model/passphrase";

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

  test("advises a longer passphrase below the recommended length without refusing it", () => {
    // Accepted, so the user is never blocked — but the hint names the cheapest
    // way to improve it. At or above the recommended length the advice stops.
    expect(estimatePassphraseStrength("Tr0ub4dor&3").hint).toContain(
      `${RECOMMENDED_VAULT_PASSPHRASE_LENGTH}+ characters is safer`,
    );
    expect(estimatePassphraseStrength("Tr0ub4dor&3xyz9!").hint).toBe("Strong passphrase");
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

  test("asks for an acknowledgement only for an acceptable but weak passphrase", () => {
    // The point of lowering the floor is that nothing acceptable is refused, so
    // the speed bump moves here. A value below the floor is already blocked and
    // must not also be asked to acknowledge something it cannot use.
    expect(requiresWeakPassphraseAcknowledgement("aaaaaaaaaaaa")).toBe(true);
    expect(requiresWeakPassphraseAcknowledgement("short")).toBe(false);
    expect(requiresWeakPassphraseAcknowledgement("")).toBe(false);
    expect(requiresWeakPassphraseAcknowledgement("Tr0ub4dor&3")).toBe(false);
    expect(requiresWeakPassphraseAcknowledgement("correct horse battery staple")).toBe(false);
  });
});
