/**
 * Fiat formatting and portfolio math checks.
 */
import { describe, expect, test } from "bun:test";
import {
  CURRENCY_SYMBOLS,
  formatFiat,
  portfolioTotal,
  tokenFiatValue,
} from "../src/sidepanel/fiat";

describe("formatFiat", () => {
  test("adds the currency glyph, thousands separators, and two decimals", () => {
    expect(formatFiat(1234.5, "usd")).toBe("$1,234.50");
    expect(formatFiat(1000000, "usd")).toBe("$1,000,000.00");
    expect(formatFiat(0.5, "gbp")).toBe("£0.50");
    expect(CURRENCY_SYMBOLS.eur).toBe("€");
  });

  test("collapses tiny positive amounts and clamps non-positive to zero", () => {
    expect(formatFiat(0.005, "eur")).toBe("€<0.01");
    expect(formatFiat(0, "usd")).toBe("$0.00");
    expect(formatFiat(Number.NaN, "usd")).toBe("$0.00");
  });
});

describe("tokenFiatValue", () => {
  test("multiplies a formatted balance by its price", () => {
    expect(tokenFiatValue("2", 3)).toBe(6);
    expect(tokenFiatValue("2.5", 4)).toBe(10);
  });

  test("returns null without a price or with a non-numeric balance", () => {
    expect(tokenFiatValue("2", undefined)).toBeNull();
    expect(tokenFiatValue("abc", 3)).toBeNull();
  });
});

describe("portfolioTotal", () => {
  test("sums priced balances and skips unpriced ones", () => {
    const balances = [
      { address: "0xa", formatted: "2" },
      { address: "0xb", formatted: "3" },
      { address: "0xc", formatted: "9" },
    ];
    expect(portfolioTotal(balances, { "0xa": 5, "0xb": 10 })).toBe(40);
    expect(portfolioTotal(balances, {})).toBe(0);
  });
});
