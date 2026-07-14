/**
 * Fiat formatting and portfolio math checks.
 */
import { describe, expect, test } from "bun:test";
import {
  CURRENCY_SYMBOLS,
  formatFiat,
  formatPriceTimestamp,
  portfolioDelta,
  portfolioTotal,
  tokenFiatValue,
} from "../src/sidepanel/fiat";

describe("formatPriceTimestamp", () => {
  test("formats an epoch as a fixed-UTC last-saved label", () => {
    // 2026-07-14T14:05:00Z — asserted in UTC so it is timezone-independent.
    expect(formatPriceTimestamp(1752501900000)).toBe("14 Jul, 14:05 UTC");
  });

  test("returns null when there is no usable timestamp", () => {
    expect(formatPriceTimestamp(null)).toBeNull();
    expect(formatPriceTimestamp(0)).toBeNull();
    expect(formatPriceTimestamp(Number.NaN)).toBeNull();
  });
});

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

// The home hero's 24h delta line reads its magnitude/direction from here.
describe("portfolioDelta", () => {
  test("reconstructs prior value from each token's 24h change and nets them", () => {
    // A holds 100 @ $2 (+25% ⇒ prior $160); B holds 10 @ $1 (-20% ⇒ prior $12.5).
    // current 200 + 10 = 210, prior 160 + 12.5 = 172.5 ⇒ +37.5 (+21.74%).
    const balances = [
      { address: "0xa", formatted: "100" },
      { address: "0xb", formatted: "10" },
    ];
    const delta = portfolioDelta(balances, { "0xa": 2, "0xb": 1 }, { "0xa": 25, "0xb": -20 });
    expect(delta?.direction).toBe("up");
    expect(delta?.absolute).toBeCloseTo(37.5, 5);
    expect(delta?.percent).toBeCloseTo(21.7391, 3);
  });

  test("flags a net loss as down with a positive magnitude", () => {
    const balances = [{ address: "0xa", formatted: "10" }];
    const delta = portfolioDelta(balances, { "0xa": 100 }, { "0xa": -20 });
    // 10 @ $100 = 1000 now, prior 1000 / 0.8 = 1250 ⇒ -250 (-20%).
    expect(delta?.direction).toBe("down");
    expect(delta?.absolute).toBeCloseTo(250, 5);
    expect(delta?.percent).toBeCloseTo(20, 5);
  });

  test("treats a missing change as flat and returns null with no baseline", () => {
    // Only B is priced and it has no change ⇒ prior equals current ⇒ zero move.
    const balances = [
      { address: "0xa", formatted: "5" },
      { address: "0xb", formatted: "4" },
    ];
    const flat = portfolioDelta(balances, { "0xb": 3 }, {});
    expect(flat).toEqual({ absolute: 0, direction: "up", percent: 0 });
    expect(portfolioDelta(balances, {}, {})).toBeNull();
  });
});
