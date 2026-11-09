/**
 * The at-rest storage budget admits the encrypted envelope of anything the
 * provider budget admits (Sherlock 261), so a storage write can never refuse
 * a vault that passed its own validators.
 */
import { describe, expect, test } from "bun:test";
import { isJson, isJsonWithinBudget, JSON_BUDGETS } from "@bramble/core/json";

// The envelope the encrypted store writes, carrying `bytes` of ciphertext.
const envelopeFor = (bytes: number) => ({
  cipher: "AES-256-GCM",
  commit: "A".repeat(24),
  data: "A".repeat(Math.ceil((bytes + 16) / 3) * 4),
  iterations: 600_000,
  iv: "A".repeat(16),
  kdf: "PBKDF2-SHA-256",
  lineage: "a".repeat(32),
  salt: "A".repeat(24),
  scope: "bramble:encrypted-store:bramble:vault",
  version: 3,
});

// The longest string of `character` the provider budget admits.
const largestProviderString = (character: string): string => {
  let low = 0;
  let high = JSON_BUDGETS.provider.maxStringLength;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (isJson(character.repeat(middle))) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return character.repeat(low);
};

describe("storage budget", () => {
  test("keeps every provider limit except size", () => {
    const { maxBytes: _bytes, maxStringLength: _length, ...rest } = JSON_BUDGETS.storage;
    const { maxBytes: _pBytes, maxStringLength: _pLength, ...providerRest } = JSON_BUDGETS.provider;
    expect(rest).toEqual(providerRest);
  });

  test("admits the envelope of the largest provider value, escapes included", () => {
    for (const character of ["a", "\u0001", "\u{1F600}"]) {
      const value = largestProviderString(character);
      const serialized = new TextEncoder().encode(JSON.stringify(value)).length;
      expect(serialized).toBeLessThanOrEqual(JSON_BUDGETS.provider.maxBytes);
      expect(isJsonWithinBudget(envelopeFor(serialized), JSON_BUDGETS.storage)).toBe(true);
    }
  });

  test("admits that envelope at the provider's own byte bound, and refuses beyond it", () => {
    const ceiling = JSON_BUDGETS.provider.maxBytes;
    expect(isJsonWithinBudget(envelopeFor(ceiling), JSON_BUDGETS.storage)).toBe(true);
    expect(isJsonWithinBudget(envelopeFor(ceiling), JSON_BUDGETS.provider)).toBe(false);
    expect(isJsonWithinBudget(envelopeFor(ceiling + 1024), JSON_BUDGETS.storage)).toBe(false);
  });
});
