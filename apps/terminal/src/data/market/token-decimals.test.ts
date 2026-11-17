/**
 * Market-API token precision is untrusted (Sherlock 155): an unusable value
 * drops the row instead of reaching `padEnd` while the swap panel renders.
 */
import { describe, expect, it } from "vitest";
import { MAX_TOKEN_DECIMALS } from "../../protocols/constants";
import { toSmallestUnit } from "../../screens/swap/swap-panel-utils";
import { toAvnuRows, toEkuboRows } from "./useTokens";

const UNUSABLE = [Number.POSITIVE_INFINITY, 1e9, -1, 6.5, Number.NaN, MAX_TOKEN_DECIMALS + 1];

describe("market token decimals", () => {
  it("drops AVNU rows whose decimals are unusable and keeps the rest", () => {
    const rows = toAvnuRows([
      { address: "0x1", decimals: 6, symbol: "GOOD" },
      { address: "0x2", symbol: "DEFAULT" },
      ...UNUSABLE.map((decimals, index) => ({
        address: `0x${(index + 10).toString(16)}`,
        decimals,
        symbol: `BAD${index}`,
      })),
    ] as never);
    // A row with no precision is dropped rather than assumed to be 18.
    expect(rows.map((row) => [row.symbol, row.decimals])).toEqual([["GOOD", 6]]);
  });

  it("drops Ekubo rows whose decimals are unusable and keeps the rest", () => {
    const rows = toEkuboRows([
      { address: "0x1", decimals: 8, symbol: "GOOD" },
      { address: "0x2", symbol: "MISSING" },
      ...UNUSABLE.map((decimals, index) => ({
        address: `0x${(index + 10).toString(16)}`,
        decimals,
        symbol: `BAD${index}`,
      })),
    ]);
    expect(rows.map((row) => [row.symbol, row.decimals])).toEqual([["GOOD", 8]]);
  });

  it("refuses to scale an amount by an unusable precision instead of throwing", () => {
    for (const decimals of UNUSABLE) {
      expect(toSmallestUnit("1.5", decimals)).toBeNull();
    }
    expect(toSmallestUnit("1.5", 6)).toBe("1500000");
    expect(toSmallestUnit("1", MAX_TOKEN_DECIMALS)).toBe(`1${"0".repeat(MAX_TOKEN_DECIMALS)}`);
  });
});
