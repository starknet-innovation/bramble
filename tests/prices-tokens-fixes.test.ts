/**
 * Regression checks for the price cache TTL and chart cache bounds:
 * an unpriced token must not defeat the TTL (A-M5), and the chart cache must
 * stay bounded and never persist an empty series (A-L10).
 */
import { describe, expect, test } from "bun:test";
import { CHARTS_STORE_KEY, createPriceService, type HttpResponse } from "../src/starknet/prices";
import type { KeyValueStore } from "../src/storage/kv";
import { createMemoryStore } from "../src/storage/kv";

const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const UNPRICED = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const jsonResponse = (body: unknown): HttpResponse => ({ json: async () => body, ok: true });

const makeHarness = (
  handler: (url: string) => HttpResponse,
): {
  readonly calls: string[];
  readonly clock: { value: number };
  readonly service: ReturnType<typeof createPriceService>;
  readonly store: KeyValueStore;
} => {
  const calls: string[] = [];
  const clock = { value: 1000 };
  const store = createMemoryStore();
  const service = createPriceService({
    http: async (url) => {
      calls.push(url);
      return handler(url);
    },
    now: () => clock.value,
    store,
  });
  return { calls, clock, service, store };
};

describe("createPriceService.getPrices unpriced coverage", () => {
  test("does not refetch within the TTL when a requested token has no listing", async () => {
    const { calls, clock, service } = makeHarness(() =>
      jsonResponse({ [USDC]: { eur: 1.5, gbp: 1.2, usd: 2 } }),
    );

    const first = await service.getPrices({
      addresses: [USDC, UNPRICED],
      currency: "usd",
      networkId: "SN_MAIN",
    });
    expect(first.prices[USDC]).toBe(2);
    expect(first.prices[UNPRICED]).toBeUndefined();

    clock.value += 1000;
    await service.getPrices({
      addresses: [USDC, UNPRICED],
      currency: "usd",
      networkId: "SN_MAIN",
    });
    // Two per-address requests on the first fetch; the absent price for
    // UNPRICED counts as covered so the second call refetches nothing.
    expect(calls).toHaveLength(2);
  });

  test("refetches once the TTL lapses even for an unpriced token", async () => {
    const { calls, clock, service } = makeHarness(() => jsonResponse({}));

    await service.getPrices({ addresses: [UNPRICED], currency: "usd", networkId: "SN_MAIN" });
    clock.value += 10 * 60 * 1000;
    await service.getPrices({ addresses: [UNPRICED], currency: "usd", networkId: "SN_MAIN" });
    expect(calls).toHaveLength(2);
  });
});

describe("createPriceService.getTokenChart cache bounds", () => {
  test("does not persist an empty chart and retries on the next call", async () => {
    const { calls, clock, service } = makeHarness(() => jsonResponse({ prices: [] }));

    const chart = await service.getTokenChart({
      address: USDC,
      currency: "usd",
      networkId: "SN_MAIN",
    });
    expect(chart.points).toEqual([]);

    clock.value += 1000;
    await service.getTokenChart({ address: USDC, currency: "usd", networkId: "SN_MAIN" });
    // An empty series was never cached, so the next call must fetch again.
    expect(calls).toHaveLength(2);
  });

  test("evicts the oldest entries so the stored chart cache stays bounded", async () => {
    const { clock, service, store } = makeHarness(() =>
      jsonResponse({
        prices: [
          [0, 1],
          [1, 2],
        ],
      }),
    );

    for (let index = 1; index <= 60; index += 1) {
      clock.value += 1000;
      await service.getTokenChart({
        address: `0x${index.toString(16)}`,
        currency: "usd",
        networkId: "SN_MAIN",
      });
    }

    const stored = (await store.get(CHARTS_STORE_KEY)) as Record<string, unknown>;
    expect(Object.keys(stored).length).toBeLessThanOrEqual(50);
  });
});
