/**
 * `sameFelt` guard coverage: non-string and empty inputs never compare equal,
 * exercising the early-return guard before the BigInt comparison, while
 * numerically-equal hex/decimal spellings still match.
 */
import { describe, expect, test } from "bun:test";
import { sameFelt } from "@bramble/wallet-model/networks";

describe("sameFelt guard branch", () => {
  test("returns false when either side is not a non-empty string", () => {
    // Non-string inputs (the typeof guard).
    expect(sameFelt(1, "0x1")).toBe(false);
    expect(sameFelt("0x1", 1)).toBe(false);
    expect(sameFelt(null, "0x1")).toBe(false);
    expect(sameFelt("0x1", undefined)).toBe(false);
    // Empty strings (the truthiness guard) — a "" felt is never a valid felt.
    expect(sameFelt("", "0x1")).toBe(false);
    expect(sameFelt("0x1", "")).toBe(false);
    expect(sameFelt("", "")).toBe(false);
  });

  test("returns false for a non-numeric string that reaches the BigInt catch", () => {
    expect(sameFelt("not-a-felt", "0x1")).toBe(false);
  });

  test("compares numerically-equal felts as equal regardless of spelling", () => {
    expect(sameFelt("0x10", "16")).toBe(true);
    expect(sameFelt("0x1", "0x1")).toBe(true);
    expect(sameFelt("0x2", "0x3")).toBe(false);
  });
});
