/**
 * Price service checks: CoinGecko parsing, the storage cache with a TTL clock,
 * and graceful offline fallback. Network access is stubbed.
 */
import { describe, expect, test } from "bun:test";
import { createPriceService, type HttpResponse } from "../src/starknet/prices";
import { createMemoryStore } from "../src/storage/kv";

const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";

const jsonResponse = (body: unknown): HttpResponse => ({ json: async () => body, ok: true });

const makeHarness = (
  handler: (url: string) => HttpResponse,
): {
  readonly calls: string[];
  readonly clock: { value: number };
  readonly service: ReturnType<typeof createPriceService>;
} => {
  const calls: string[] = [];
  const clock = { value: 1000 };
  const service = createPriceService({
    http: async (url) => {
      calls.push(url);
      return handler(url);
    },
    now: () => clock.value,
    store: createMemoryStore(),
  });
  return { calls, clock, service };
};

describe("createPriceService.getPrices", () => {
  test("fetches, slices the requested currency, and caches within the TTL", async () => {
    const { calls, clock, service } = makeHarness(() =>
      jsonResponse({ [USDC]: { eur: 1.5, gbp: 1.2, usd: 2 } }),
    );

    const first = await service.getPrices({
      addresses: [USDC],
      currency: "usd",
      networkId: "SN_MAIN",
    });
    expect(first).toEqual({ currency: "usd", prices: { [USDC]: 2 } });

    clock.value += 1000;
    const second = await service.getPrices({
      addresses: [USDC],
      currency: "eur",
      networkId: "SN_MAIN",
    });
    expect(second.prices[USDC]).toBe(1.5);
    expect(calls).toHaveLength(1);

    clock.value += 10 * 60 * 1000;
    await service.getPrices({ addresses: [USDC], currency: "usd", networkId: "SN_MAIN" });
    expect(calls).toHaveLength(2);
  });

  test("skips the network on test networks and empty address sets", async () => {
    const { calls, service } = makeHarness(() => jsonResponse({}));

    expect(
      await service.getPrices({ addresses: [USDC], currency: "usd", networkId: "SN_SEPOLIA" }),
    ).toEqual({ currency: "usd", prices: {} });
    expect(
      await service.getPrices({ addresses: [], currency: "usd", networkId: "SN_MAIN" }),
    ).toEqual({ currency: "usd", prices: {} });
    expect(calls).toHaveLength(0);
  });

  test("returns empty prices when the feed is offline", async () => {
    const { service } = makeHarness(() => {
      throw new Error("offline");
    });

    expect(
      await service.getPrices({ addresses: [USDC], currency: "usd", networkId: "SN_MAIN" }),
    ).toEqual({ currency: "usd", prices: {} });
  });
});

describe("createPriceService.getTokenChart", () => {
  test("extracts the price column and caches it", async () => {
    const { calls, clock, service } = makeHarness(() =>
      jsonResponse({
        prices: [
          [0, 1],
          [1, 2],
          [2, 3],
        ],
      }),
    );

    const chart = await service.getTokenChart({
      address: USDC,
      currency: "usd",
      networkId: "SN_MAIN",
    });
    expect(chart).toEqual({ currency: "usd", points: [1, 2, 3] });

    clock.value += 1000;
    await service.getTokenChart({ address: USDC, currency: "usd", networkId: "SN_MAIN" });
    expect(calls).toHaveLength(1);
  });

  test("returns no points when offline with no cache", async () => {
    const { service } = makeHarness(() => ({ json: async () => ({}), ok: false }));

    expect(
      await service.getTokenChart({ address: USDC, currency: "usd", networkId: "SN_MAIN" }),
    ).toEqual({ currency: "usd", points: [] });
  });
});
