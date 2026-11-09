/**
 * Per-address price freshness (mc-wallet #357): refreshing one token must not
 * make another token's old cached price read as current.
 */
import { describe, expect, test } from "bun:test";
import { createPriceService, type HttpResponse } from "@bramble/portfolio/prices";
import { createMemoryStore } from "@bramble/store/kv";

const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const STRK = `0x${2n.toString(16).padStart(64, "0")}`;
const TTL_PLUS = 10 * 60 * 1000;

const ok = (body: unknown): HttpResponse => ({ json: async () => body, ok: true });
const notOk = (): HttpResponse => ({ json: async () => ({}), ok: false });

const makeHarness = () => {
  const clock = { value: 1_000 };
  const feed: { strk: "up" | "down" | "empty" } = { strk: "up" };
  const calls: string[] = [];
  const service = createPriceService({
    http: async (url) => {
      calls.push(url);
      if (url.includes(USDC)) return ok({ [USDC]: { eur: 1, gbp: 1, usd: 1 } });
      if (feed.strk === "down") return notOk();
      return ok(feed.strk === "empty" ? {} : { [STRK]: { eur: 4, gbp: 4, usd: 4 } });
    },
    now: () => clock.value,
    store: createMemoryStore(),
  });
  return { calls, clock, feed, service };
};

const both = { addresses: [USDC, STRK], currency: "usd", networkId: "SN_MAIN" } as const;

describe("createPriceService per-address freshness", () => {
  test("a partial refresh stays stale and dated to the old leg within the TTL", async () => {
    const { clock, feed, service } = makeHarness();
    await service.getPrices(both);
    clock.value += TTL_PLUS;
    feed.strk = "down";
    expect(await service.getPrices(both)).toMatchObject({ asOf: 1_000, stale: true });
    clock.value += 1_000;
    expect(await service.getPrices(both)).toMatchObject({ asOf: 1_000, stale: true });
  });

  test("refreshing one token alone does not freshen another token's cached price", async () => {
    const { calls, clock, service } = makeHarness();
    await service.getPrices(both);
    clock.value += TTL_PLUS;
    await service.getPrices({ ...both, addresses: [USDC] });
    const before = calls.length;
    const answer = await service.getPrices(both);
    // STRK's own capture is past the TTL, so it is refetched, not reused.
    expect(calls.length).toBeGreaterThan(before);
    expect(answer).toMatchObject({ asOf: clock.value, stale: false });
  });

  test("a cached-only read reports the oldest per-address capture", async () => {
    const { clock, service } = makeHarness();
    await service.getPrices(both);
    clock.value += TTL_PLUS;
    await service.getPrices({ ...both, addresses: [USDC] });
    expect(await service.getPrices({ ...both, cached: true })).toMatchObject({
      asOf: 1_000,
      stale: true,
    });
  });

  test("a fresh cache hit reports the capture time, not the read time", async () => {
    const { calls, clock, service } = makeHarness();
    await service.getPrices(both);
    clock.value += 60_000;
    const before = calls.length;
    expect(await service.getPrices(both)).toMatchObject({ asOf: 1_000, stale: false });
    expect(calls.length).toBe(before);
  });

  test("a refresh stamp from the future (clock rollback) is not fresh", async () => {
    const { calls, clock, feed, service } = makeHarness();
    clock.value = 10_000;
    await service.getPrices(both);
    clock.value = 9_500;
    feed.strk = "down";
    const before = calls.length;
    expect(await service.getPrices(both)).toMatchObject({ stale: true });
    expect(calls.length).toBeGreaterThan(before);
  });

  test("an answer with no usable price drops the old cached price", async () => {
    const { clock, feed, service } = makeHarness();
    await service.getPrices(both);
    clock.value += TTL_PLUS;
    feed.strk = "empty";
    const answer = await service.getPrices(both);
    expect(answer.prices).toEqual({ [USDC]: 1 });
    clock.value += 1_000;
    expect((await service.getPrices(both)).prices).toEqual({ [USDC]: 1 });
  });
});
