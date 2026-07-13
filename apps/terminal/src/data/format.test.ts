/**
 * Pure formatter + candle-normalization tests — no network, no DOM. These pin the
 * numeric behavior the hooks and screens depend on.
 */
import { describe, expect, it } from "vitest";
import { formatCompactUsd, formatTokenAmount } from "./format";
import { toAvnuCandles } from "./useCandles";

describe("formatTokenAmount", () => {
  it("formats a whole-ether u256 balance", () => {
    const { display, amount } = formatTokenAmount(1_000_000_000_000_000_000n, 18);
    expect(display).toBe("1");
    expect(amount).toBe(1);
  });

  it("formats a 6-decimal stablecoin balance with separators", () => {
    const { display, amount } = formatTokenAmount(1_234_500_000n, 6);
    expect(display).toBe("1,234.5");
    expect(amount).toBe(1234.5);
  });

  it("returns zero for an empty balance", () => {
    const { display, amount } = formatTokenAmount(0n, 18);
    expect(display).toBe("0");
    expect(amount).toBe(0);
  });
});

describe("formatCompactUsd", () => {
  it("compacts millions and billions", () => {
    expect(formatCompactUsd(684_200_000)).toBe("$684.2M");
    expect(formatCompactUsd(1_280_000_000)).toBe("$1.28B");
  });
});

describe("toAvnuCandles", () => {
  it("normalizes and sorts dated OHLC rows", () => {
    const candles = toAvnuCandles([
      { date: "2026-07-10T01:00:00Z", open: 105, high: 120, low: 104, close: 120 },
      { date: "2026-07-10T00:00:00Z", open: 100, high: 110, low: 100, close: 110 },
    ]);
    expect(candles.length).toBe(2);
    expect(candles[0]).toMatchObject({ open: 100, high: 110, low: 100, close: 110 });
    expect(candles[0]!.time).toBeLessThan(candles[1]!.time);
    expect(candles[1]).toMatchObject({ open: 105, high: 120, low: 104, close: 120 });
  });

  it("drops malformed rows", () => {
    expect(toAvnuCandles([{ date: "not-a-date", open: 1, high: 1, low: 1, close: 1 }])).toEqual([]);
  });
});
