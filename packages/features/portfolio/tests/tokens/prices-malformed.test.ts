/**
 * Degenerate-input coverage for the price service: a malformed contract address
 * that BigInt cannot parse falls back to its lowercased form (normalizeAddress
 * catch), and a market_chart body whose `prices` column is missing or not an
 * array yields an empty series (parseChartBody guard), which the chart reader
 * surfaces as the cached-or-empty points list. Mirrors the injected-fetch
 * harness of tests/starknet/prices.test.ts and tests/starknet/prices-tokens-fixes.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { createPriceService, type HttpResponse } from "@mc-wallet/portfolio/prices";
import { createMemoryStore } from "@mc-wallet/store/kv";

const jsonResponse = (body: unknown): HttpResponse => ({ json: async () => body, ok: true });

const makeHarness = (
  handler: (url: string) => HttpResponse,
): {
  readonly calls: string[];
  readonly service: ReturnType<typeof createPriceService>;
} => {
  const calls: string[] = [];
  const service = createPriceService({
    http: async (url) => {
      calls.push(url);
      return handler(url);
    },
    now: () => 1000,
    store: createMemoryStore(),
  });
  return { calls, service };
};

describe("price service degenerate inputs", () => {
  test("normalizes a malformed address to its lowercased form", async () => {
    // "0xZZZ" is not BigInt-parseable, so normalizeAddress falls into the catch
    // and lowercases the raw string instead of padding a felt. The service must
    // still resolve rather than throw, and price the token under that key.
    const bad = "0xZZZ";
    const { calls, service } = makeHarness((url) =>
      // CoinGecko is queried with the lowercased address; answer for it.
      url.includes(encodeURIComponent("0xzzz"))
        ? jsonResponse({ "0xzzz": { eur: 1.1, gbp: 0.9, usd: 1.3 } })
        : jsonResponse({}),
    );

    const result = await service.getPrices({
      addresses: [bad],
      currency: "usd",
      networkId: "SN_MAIN",
    });

    // The request URL carried the lowercased (catch-path) address...
    expect(calls.some((url) => url.includes(encodeURIComponent("0xzzz")))).toBe(true);
    // ...and the returned price is keyed by the caller's original address string.
    expect(result.prices[bad]).toBe(1.3);
    expect(result.stale).toBe(false);
  });

  test("returns an empty chart series when the body has no prices array", async () => {
    const { service } = makeHarness(() => jsonResponse({ prices: "not-an-array" }));

    const chart = await service.getTokenChart({
      address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
      currency: "usd",
      networkId: "SN_MAIN",
    });

    expect(chart.points).toEqual([]);
    expect(chart.currency).toBe("usd");
  });

  test("returns an empty chart series when the prices key is absent entirely", async () => {
    const { service } = makeHarness(() => jsonResponse({ market_caps: [[0, 1]] }));

    const chart = await service.getTokenChart({
      address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
      currency: "eur",
      networkId: "SN_MAIN",
    });

    expect(chart.points).toEqual([]);
  });
});
