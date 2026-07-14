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
    expect(first).toEqual({
      asOf: 1000,
      changes: {},
      currency: "usd",
      prices: { [USDC]: 2 },
      stale: false,
    });

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
    ).toEqual({ asOf: null, changes: {}, currency: "usd", prices: {}, stale: false });
    expect(
      await service.getPrices({ addresses: [], currency: "usd", networkId: "SN_MAIN" }),
    ).toEqual({ asOf: null, changes: {}, currency: "usd", prices: {}, stale: false });
    expect(calls).toHaveLength(0);
  });

  test("returns empty, stale-flagged prices when offline with no cache", async () => {
    const { service } = makeHarness(() => {
      throw new Error("offline");
    });

    // No cache yet and the host is unreachable: nothing to show, but the caller
    // is told prices are stale so the UI can surface an explicit hint.
    expect(
      await service.getPrices({ addresses: [USDC], currency: "usd", networkId: "SN_MAIN" }),
    ).toEqual({ asOf: null, changes: {}, currency: "usd", prices: {}, stale: true });
  });

  test("falls back to the last-known-good prices when the host becomes unreachable", async () => {
    let online = true;
    const { clock, service } = makeHarness((url) => {
      if (!online) {
        throw new Error("offline");
      }
      return url.includes("include_24hr_change")
        ? jsonResponse({ [USDC]: { eur: 1.5, gbp: 1.2, usd: 2, usd_24h_change: 4 } })
        : jsonResponse({ [USDC]: { eur: 1.5, gbp: 1.2, usd: 2 } });
    });

    const live = await service.getPrices({
      addresses: [USDC],
      currency: "usd",
      networkId: "SN_MAIN",
    });
    expect(live).toEqual({
      asOf: 1000,
      changes: { [USDC]: 4 },
      currency: "usd",
      prices: { [USDC]: 2 },
      stale: false,
    });

    // Host goes down and the TTL lapses so a refresh is attempted and fails.
    online = false;
    clock.value += 10 * 60 * 1000;
    const fallback = await service.getPrices({
      addresses: [USDC],
      currency: "usd",
      networkId: "SN_MAIN",
    });
    // The cached values survive, flagged stale and stamped with the original
    // capture time (1000), not the failed-refresh clock.
    expect(fallback).toEqual({
      asOf: 1000,
      changes: { [USDC]: 4 },
      currency: "usd",
      prices: { [USDC]: 2 },
      stale: true,
    });

    // Host recovers on the next refresh: fresh, non-stale prices with a new asOf.
    online = true;
    clock.value += 10 * 60 * 1000;
    const recovered = await service.getPrices({
      addresses: [USDC],
      currency: "eur",
      networkId: "SN_MAIN",
    });
    expect(recovered.stale).toBe(false);
    expect(recovered.asOf).toBe(clock.value);
    expect(recovered.prices[USDC]).toBe(1.5);
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
