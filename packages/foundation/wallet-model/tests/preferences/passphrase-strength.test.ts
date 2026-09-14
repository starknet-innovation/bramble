/**
 * The setup meter's strength estimate is feedback that tracks the typed text
 * monotonically and never reads as acceptable before the 12-character
 * validator does.
 */
import { describe, expect, test } from "bun:test";
import { estimatePassphraseStrength, isVaultPassphrase } from "@bramble/wallet-model/passphrase";

describe("estimatePassphraseStrength", () => {
  test("is empty for no input and weak below the minimum length", () => {
    expect(estimatePassphraseStrength("")).toEqual({
      hint: "Enter at least 12 characters",
      level: "empty",
      ratio: 0,
    });
    const short = estimatePassphraseStrength("Tr0ub4dor&3");
    expect(short.level).toBe("weak");
    expect(short.ratio).toBeLessThanOrEqual(0.4);
    expect(isVaultPassphrase("Tr0ub4dor&3")).toBe(false);
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
});
