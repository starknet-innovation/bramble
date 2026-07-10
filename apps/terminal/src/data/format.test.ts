/**
 * Pure formatter + candle-bucketing tests — no network, no DOM. These pin the
 * numeric behavior the hooks and screens depend on.
 */
import { describe, expect, it } from "vitest";
import { formatCompactUsd, formatTokenAmount } from "./format";
import { bucketCandles } from "./useCandles";

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

describe("bucketCandles", () => {
  it("buckets a [ms, price] series into ascending OHLC candles", () => {
    // Two points inside bucket 0 and one in a later bucket, over a 1-day window.
    const bucketMs = Math.floor((1 * 86_400) / 90) * 1000; // matches hook math
    const prices: [number, number][] = [
      [0, 100],
      [1000, 110],
      [bucketMs + 1000, 120],
    ];
    const candles = bucketCandles(prices, 1);
    expect(candles.length).toBe(2);
    // First bucket: open 100, high 110, low 100, close 110.
    expect(candles[0]).toMatchObject({ open: 100, high: 110, low: 100, close: 110 });
    // Candles are ascending by time.
    expect(candles[0]!.time).toBeLessThan(candles[1]!.time);
    expect(candles[1]).toMatchObject({ open: 120, close: 120 });
  });

  it("returns an empty array for an empty series", () => {
    expect(bucketCandles([], 1)).toEqual([]);
  });
});
