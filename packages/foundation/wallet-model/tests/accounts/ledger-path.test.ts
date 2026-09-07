/**
 * EIP-2645 Ledger path checks: builders and validators must round-trip and
 * reject any path this module could not have produced, since a mismatched path
 * silently selects a different device key.
 */
import { describe, expect, test } from "bun:test";
import {
  isLedgerAccountIndex,
  isLedgerAccountPath,
  LEDGER_EIP2645_APPLICATION,
  ledgerAccountIndexOfPath,
  ledgerAccountPath,
} from "@bramble/wallet-model/ledger-path";

const MAX_INDEX = 0x80000000 - 1;

describe("ledgerAccountPath", () => {
  test("builds the canonical hardened LedgerW path for an index", () => {
    expect(ledgerAccountPath(0)).toBe("m/2645'/1195502025'/734980059'/0'/0'/0");
    expect(ledgerAccountPath(5)).toBe("m/2645'/1195502025'/734980059'/0'/5'/0");
    expect(ledgerAccountPath(MAX_INDEX)).toBe(`m/2645'/1195502025'/734980059'/0'/${MAX_INDEX}'/0`);
  });

  test("pins the LedgerW application segment", () => {
    expect(LEDGER_EIP2645_APPLICATION).toBe("LedgerW");
  });

  test("throws on an out-of-range index rather than emitting a bad path", () => {
    expect(() => ledgerAccountPath(-1)).toThrow("out of range");
    expect(() => ledgerAccountPath(0x80000000)).toThrow("out of range");
    expect(() => ledgerAccountPath(1.5)).toThrow("out of range");
  });
});

describe("isLedgerAccountIndex", () => {
  test("accepts non-negative safe integers below the hardened ceiling", () => {
    expect(isLedgerAccountIndex(0)).toBe(true);
    expect(isLedgerAccountIndex(MAX_INDEX)).toBe(true);
  });

  test("rejects out-of-range, fractional, and non-number values", () => {
    expect(isLedgerAccountIndex(-1)).toBe(false);
    expect(isLedgerAccountIndex(0x80000000)).toBe(false);
    expect(isLedgerAccountIndex(1.5)).toBe(false);
    expect(isLedgerAccountIndex("0")).toBe(false);
    expect(isLedgerAccountIndex(Number.NaN)).toBe(false);
  });
});

describe("isLedgerAccountPath and ledgerAccountIndexOfPath", () => {
  test("round-trip a built path back to its index", () => {
    for (const index of [0, 1, 9, 128, MAX_INDEX]) {
      const path = ledgerAccountPath(index);
      expect(isLedgerAccountPath(path)).toBe(true);
      expect(ledgerAccountIndexOfPath(path)).toBe(index);
    }
  });

  test("rejects paths this module could not have produced", () => {
    for (const bad of [
      "",
      "m/2645'/1195502025'/734980059'/0'/0'/1", // wrong leaf
      "m/2645'/1195502025'/734980059'/0'/0'", // missing leaf
      "m/44'/9004'/0'/0/0", // BIP-44, not EIP-2645
      "m/2645'/1195502025'/734980059'/0'/01'/0", // non-canonical leading zero
      "m/2645'/1195502025'/734980059'/0'/-1'/0", // negative leaf
      `m/2645'/1195502025'/734980059'/0'/${0x80000000}'/0`, // out of range
      42,
      null,
    ]) {
      expect(isLedgerAccountPath(bad)).toBe(false);
      expect(ledgerAccountIndexOfPath(bad)).toBeNull();
    }
  });
});
