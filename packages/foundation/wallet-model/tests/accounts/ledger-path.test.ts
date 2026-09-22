/**
 * EIP-2645 Ledger path checks: builders and validators must round-trip under
 * each supported application scheme and reject any path this module could not
 * have produced, since a mismatched path silently selects a different device
 * key. The Ready (`argentx`) scheme is pinned to Ready's own
 * `STANDARD_LEDGER_DERIVATION_PATH` so a restored Ready account asks the device
 * for exactly the key Ready signs with.
 */
import { describe, expect, test } from "bun:test";
import {
  isLedgerAccountIndex,
  isLedgerAccountPath,
  isLedgerEip2645Application,
  LEDGER_EIP2645_APPLICATION,
  ledgerAccountIndexOfPath,
  ledgerAccountPath,
  parseLedgerAccountPath,
  READY_EIP2645_APPLICATION,
} from "@bramble/wallet-model/ledger-path";

const MAX_INDEX = 0x80000000 - 1;

describe("ledgerAccountPath", () => {
  test("builds the canonical hardened LedgerW path for an index by default", () => {
    expect(ledgerAccountPath(0)).toBe("m/2645'/1195502025'/734980059'/0'/0'/0");
    expect(ledgerAccountPath(5)).toBe("m/2645'/1195502025'/734980059'/0'/5'/0");
    expect(ledgerAccountPath(MAX_INDEX)).toBe(`m/2645'/1195502025'/734980059'/0'/${MAX_INDEX}'/0`);
    expect(ledgerAccountPath(5, LEDGER_EIP2645_APPLICATION)).toBe(ledgerAccountPath(5));
  });

  test("builds Ready's argentx path — sha256('argentx') application, plain leaf index", () => {
    // Ready: STANDARD_LEDGER_DERIVATION_PATH = "m/2645'/1195502025'/1148870696'/0'/0'" + "/<index>".
    expect(ledgerAccountPath(0, READY_EIP2645_APPLICATION)).toBe(
      "m/2645'/1195502025'/1148870696'/0'/0'/0",
    );
    expect(ledgerAccountPath(12, READY_EIP2645_APPLICATION)).toBe(
      "m/2645'/1195502025'/1148870696'/0'/0'/12",
    );
    expect(ledgerAccountPath(MAX_INDEX, READY_EIP2645_APPLICATION)).toBe(
      `m/2645'/1195502025'/1148870696'/0'/0'/${MAX_INDEX}`,
    );
  });

  test("the two schemes never coincide for the same index", () => {
    for (const index of [0, 1, 7, MAX_INDEX]) {
      expect(ledgerAccountPath(index)).not.toBe(
        ledgerAccountPath(index, READY_EIP2645_APPLICATION),
      );
    }
  });

  test("pins the application markers", () => {
    expect(LEDGER_EIP2645_APPLICATION).toBe("LedgerW");
    expect(READY_EIP2645_APPLICATION).toBe("argentx");
    expect(isLedgerEip2645Application("LedgerW")).toBe(true);
    expect(isLedgerEip2645Application("argentx")).toBe(true);
    for (const bad of ["ledgerw", "ArgentX", "argent", "starknet", "", 0, null, undefined]) {
      expect(isLedgerEip2645Application(bad)).toBe(false);
    }
  });

  test("throws on an out-of-range index rather than emitting a bad path", () => {
    for (const application of [LEDGER_EIP2645_APPLICATION, READY_EIP2645_APPLICATION]) {
      expect(() => ledgerAccountPath(-1, application)).toThrow("out of range");
      expect(() => ledgerAccountPath(0x80000000, application)).toThrow("out of range");
      expect(() => ledgerAccountPath(1.5, application)).toThrow("out of range");
    }
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

describe("parseLedgerAccountPath, isLedgerAccountPath and ledgerAccountIndexOfPath", () => {
  test("round-trip a built path back to its scheme and index", () => {
    for (const application of [LEDGER_EIP2645_APPLICATION, READY_EIP2645_APPLICATION]) {
      for (const index of [0, 1, 9, 128, MAX_INDEX]) {
        const path = ledgerAccountPath(index, application);
        expect(isLedgerAccountPath(path)).toBe(true);
        expect(ledgerAccountIndexOfPath(path)).toBe(index);
        expect(parseLedgerAccountPath(path)).toEqual({ accountIndex: index, application });
      }
    }
  });

  test("rejects paths neither scheme could have produced", () => {
    for (const bad of [
      "",
      "m/2645'/1195502025'/734980059'/0'/0'/1", // LedgerW with a wrong leaf
      "m/2645'/1195502025'/734980059'/0'/0'", // LedgerW missing leaf
      "m/2645'/1195502025'/734980059'/0'/0", // LedgerW layout with a plain index (argentx-style leaf)
      "m/2645'/1195502025'/1148870696'/0'/0'/0'", // argentx with a hardened leaf
      "m/2645'/1195502025'/1148870696'/0'/0'/0/0", // argentx with an extra level
      "m/2645'/1195502025'/1148870696'/0'/1'/0", // argentx layout with a LedgerW-style hardened index
      "m/2645'/1195502025'/1148870696'/0'/0'", // argentx missing leaf
      "m/2645'/1195502025'/1148870696'/1'/0'/0", // Ready's multisig path, not a standard account
      "m/44'/9004'/0'/0/0", // BIP-44, not EIP-2645
      "m/2645'/1195502025'/734980059'/0'/01'/0", // non-canonical leading zero
      "m/2645'/1195502025'/1148870696'/0'/0'/01", // non-canonical leading zero
      "m/2645'/1195502025'/734980059'/0'/-1'/0", // negative leaf
      `m/2645'/1195502025'/734980059'/0'/${0x80000000}'/0`, // out of range
      `m/2645'/1195502025'/1148870696'/0'/0'/${0x80000000}`, // out of range
      42,
      null,
    ]) {
      expect(isLedgerAccountPath(bad)).toBe(false);
      expect(ledgerAccountIndexOfPath(bad)).toBeNull();
      expect(parseLedgerAccountPath(bad)).toBeNull();
    }
  });
});
