/**
 * Token response validator checks for detection, prices, and charts.
 */
import { describe, expect, test } from "bun:test";
import {
  isDetectTokensResponse,
  isPricesResponse,
  isTokenChartResponse,
} from "../../../src/popup/responses/responses";

const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const suggestion = {
  address: USDC,
  balance: "1000000",
  decimals: 6,
  formatted: "1.0",
  id: `SN_MAIN:USDC:${USDC}`,
  name: "USD Coin",
  networkId: "SN_MAIN",
  symbol: "USDC",
};

describe("isDetectTokensResponse", () => {
  test("accepts well-formed suggestions and rejects malformed ones", () => {
    expect(isDetectTokensResponse({ ok: true, suggestions: [suggestion] })).toBe(true);
    expect(isDetectTokensResponse({ ok: true, suggestions: [] })).toBe(true);
    expect(
      isDetectTokensResponse({ ok: true, suggestions: [{ ...suggestion, symbol: "bad!" }] }),
    ).toBe(false);
    expect(isDetectTokensResponse({ ok: true, suggestions: "nope" })).toBe(false);
  });
});

describe("isPricesResponse", () => {
  test("requires a known currency and numeric prices", () => {
    expect(isPricesResponse({ currency: "usd", ok: true, prices: { [USDC]: 2 } })).toBe(true);
    expect(isPricesResponse({ currency: "usd", ok: true, prices: {} })).toBe(true);
    expect(isPricesResponse({ currency: "btc", ok: true, prices: {} })).toBe(false);
    expect(isPricesResponse({ currency: "usd", ok: true, prices: { [USDC]: "2" } })).toBe(false);
  });

  test("accepts the optional staleness metadata and rejects malformed variants", () => {
    expect(
      isPricesResponse({ asOf: 1000, currency: "usd", ok: true, prices: {}, stale: true }),
    ).toBe(true);
    // asOf is nullable (nothing cached yet).
    expect(
      isPricesResponse({ asOf: null, currency: "usd", ok: true, prices: {}, stale: false }),
    ).toBe(true);
    expect(
      isPricesResponse({ asOf: "1000", currency: "usd", ok: true, prices: {}, stale: false }),
    ).toBe(false);
    expect(isPricesResponse({ currency: "usd", ok: true, prices: {}, stale: "yes" })).toBe(false);
  });
});

describe("isTokenChartResponse", () => {
  test("requires a known currency and a finite number series", () => {
    expect(isTokenChartResponse({ currency: "eur", ok: true, points: [1, 2, 3] })).toBe(true);
    expect(isTokenChartResponse({ currency: "eur", ok: true, points: [] })).toBe(true);
    expect(isTokenChartResponse({ currency: "eur", ok: true, points: [1, "2"] })).toBe(false);
    expect(isTokenChartResponse({ currency: "gbp", ok: true })).toBe(false);
  });
});
