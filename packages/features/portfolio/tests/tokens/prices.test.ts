/**
 * Price service checks: CoinGecko parsing, the storage cache with a TTL clock,
 * and graceful offline fallback. Network access is stubbed.
 */
import { describe, expect, test } from "bun:test";
import {
  createPriceService,
  type HttpResponse,
  PRICE_CHART_POINT_LIMIT,
} from "@bramble/portfolio/prices";
import { createMemoryStore } from "@bramble/store/kv";

const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";

const jsonResponse = (body: unknown): HttpResponse => ({ json: async () => body, ok: true });

// A failed CoinGecko request (non-ok): readJsonRecord throws, so the address
// stays uncovered and is not marked freshly fetched.
const notOk = (): HttpResponse => ({ json: async () => ({}), ok: false });

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
    const cached = await service.getPrices({
      addresses: [USDC],
      cached: true,
      currency: "usd",
      networkId: "SN_MAIN",
    });
    expect(cached).toMatchObject({ asOf: 1000, prices: { [USDC]: 2 }, stale: true });
    expect(calls).toHaveLength(1);
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

  test("never serves cached mainnet prices or charts on a network with no fiat feed (Sherlock 185)", async () => {
    const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
    const { service } = makeHarness((url) =>
      url.includes("market_chart")
        ? jsonResponse({
            prices: [
              [1, 4_000],
              [2, 4_200],
            ],
          })
        : jsonResponse({ [ETH]: { eur: 3_900, gbp: 3_300, usd: 4_200, usd_24h_change: 3 } }),
    );
    const mainnet = await service.getPrices({
      addresses: [ETH],
      currency: "usd",
      networkId: "SN_MAIN",
    });
    expect(mainnet.prices[ETH]).toBe(4_200);
    expect(
      (await service.getTokenChart({ address: ETH, currency: "usd", networkId: "SN_MAIN" })).points,
    ).not.toEqual([]);

    // Sepolia's ETH has the same contract address as mainnet's.
    expect(
      await service.getPrices({ addresses: [ETH], currency: "usd", networkId: "SN_SEPOLIA" }),
    ).toEqual({ asOf: null, changes: {}, currency: "usd", prices: {}, stale: false });
    expect(
      await service.getTokenChart({ address: ETH, currency: "usd", networkId: "SN_SEPOLIA" }),
    ).toEqual({ currency: "usd", points: [] });
  });

  test("returns empty, stale-flagged prices when offline with no cache", async () => {
    const { calls, service } = makeHarness(() => {
      throw new Error("offline");
    });

    // No cache yet and the host is unreachable: nothing to show, but the caller
    // is told prices are stale so the UI can surface an explicit hint.
    expect(
      await service.getPrices({ addresses: [USDC], currency: "usd", networkId: "SN_MAIN" }),
    ).toEqual({ asOf: null, changes: {}, currency: "usd", prices: {}, stale: true });
    await service.getPrices({ addresses: [USDC], currency: "usd", networkId: "SN_MAIN" });
    expect(calls).toHaveLength(1);
  });

  test("falls back to the last-known-good prices when the host becomes unreachable", async () => {
    let online = true;
    const { calls, clock, service } = makeHarness((url) => {
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
    await service.getPrices({ addresses: [USDC], currency: "usd", networkId: "SN_MAIN" });
    expect(calls).toHaveLength(2);

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

  // A second tracked token whose CoinGecko request fails while USDC's succeeds.
  const STRK = `0x${2n.toString(16).padStart(64, "0")}`;

  test("flags a mixed fetch stale and drops a never-cached failed token", async () => {
    // First call: USDC prices, STRK request returns non-ok. No prior cache, so
    // STRK has no last-known value to serve.
    const { clock, service } = makeHarness((url) =>
      url.includes(USDC) ? jsonResponse({ [USDC]: { eur: 1.5, gbp: 1.2, usd: 2 } }) : notOk(),
    );

    const mixed = await service.getPrices({
      addresses: [USDC, STRK],
      currency: "usd",
      networkId: "SN_MAIN",
    });
    // USDC is fresh, but STRK could not be fetched and was never cached: the
    // snapshot is flagged stale (so the UI shows the degraded notice) and STRK is
    // simply absent from prices — unavailable, never passed off as live.
    expect(mixed.stale).toBe(true);
    expect(mixed.prices).toEqual({ [USDC]: 2 });
    expect(mixed.prices[STRK]).toBeUndefined();
    // No cached data contributed, so the served snapshot is dated to now().
    expect(mixed.asOf).toBe(clock.value);
  });

  test("ignores unrelated addresses injected into a single-address response", async () => {
    const { calls, service } = makeHarness((url) =>
      url.includes(USDC)
        ? jsonResponse({
            [STRK]: { eur: 666, gbp: 666, usd: 666 },
            [USDC]: { eur: 1.5, gbp: 1.2, usd: 2 },
          })
        : jsonResponse({ [STRK]: { eur: 3, gbp: 2.5, usd: 4 } }),
    );

    await service.getPrices({ addresses: [USDC], currency: "usd", networkId: "SN_MAIN" });
    const strk = await service.getPrices({
      addresses: [STRK],
      currency: "usd",
      networkId: "SN_MAIN",
    });

    expect(calls).toHaveLength(2);
    expect(strk.prices).toEqual({ [STRK]: 4 });
  });

  test("dates a mixed fetch to the oldest contributing capture when serving a cached token", async () => {
    let strkOnline = true;
    const { clock, service } = makeHarness((url) => {
      if (url.includes(USDC)) {
        return jsonResponse({ [USDC]: { eur: 1.5, gbp: 1.2, usd: 2 } });
      }
      return strkOnline ? jsonResponse({ [STRK]: { eur: 3, gbp: 2.5, usd: 4 } }) : notOk();
    });

    // Warm the cache with both tokens at t=1000.
    const warm = await service.getPrices({
      addresses: [USDC, STRK],
      currency: "usd",
      networkId: "SN_MAIN",
    });
    expect(warm).toEqual({
      asOf: 1000,
      changes: {},
      currency: "usd",
      prices: { [USDC]: 2, [STRK]: 4 },
      stale: false,
    });

    // STRK goes down and the TTL lapses; USDC refreshes fine.
    strkOnline = false;
    clock.value += 10 * 60 * 1000;
    const mixed = await service.getPrices({
      addresses: [USDC, STRK],
      currency: "usd",
      networkId: "SN_MAIN",
    });
    // STRK is served from the older cache, so even though USDC is fresh the whole
    // snapshot is stale and dated to the oldest contributing capture (1000), not
    // the refresh clock — a days-old value never masquerades as live.
    expect(mixed.stale).toBe(true);
    expect(mixed.asOf).toBe(1000);
    expect(mixed.prices).toEqual({ [USDC]: 2, [STRK]: 4 });
  });
});

describe("createPriceService.getTokenChart", () => {
  test("bounds one hostile chart response before caching it", async () => {
    const points = Array.from({ length: PRICE_CHART_POINT_LIMIT + 1 }, (_, index) => [
      index,
      index,
    ]);
    const { service } = makeHarness(() => jsonResponse({ prices: points }));

    const chart = await service.getTokenChart({
      address: USDC,
      currency: "usd",
      networkId: "SN_MAIN",
    });
    expect(chart.points).toHaveLength(PRICE_CHART_POINT_LIMIT);
  });

  test("does not scan past the chart point budget looking for valid rows", async () => {
    const points: unknown[] = Array.from({ length: PRICE_CHART_POINT_LIMIT }, () => null);
    points.push([0, 666]);
    const { service } = makeHarness(() => jsonResponse({ prices: points }));

    const chart = await service.getTokenChart({
      address: USDC,
      currency: "usd",
      networkId: "SN_MAIN",
    });
    expect(chart.points).toEqual([]);
  });

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
