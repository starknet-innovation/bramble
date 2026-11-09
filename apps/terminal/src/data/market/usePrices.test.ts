import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAINNET_TOKEN_ADDRESSES } from "../../protocols/index";

// The test environment switches the shared cache off, so this double gives
// getJson a real TTL cache: what is under test is which reader honours it.
const feed = vi.hoisted(() => ({
  ethUsd: 2_000,
  fail: false,
  cache: new Map<string, { readonly expires: number; readonly value: unknown }>(),
  now: 0,
}));

vi.mock("../core/cache", () => ({
  getJson: async (url: string, opts: { readonly cacheMs?: number } = {}) => {
    const ttl = opts.cacheMs ?? 0;
    const hit = feed.cache.get(url);
    if (ttl > 0 && hit !== undefined && hit.expires > feed.now) return hit.value;
    if (feed.fail) throw new Error("feed down");
    const value = [
      {
        address: MAINNET_TOKEN_ADDRESSES.ETH,
        decimals: 18,
        global: { usd: feed.ethUsd },
        name: "Ether",
        symbol: "ETH",
      },
    ];
    if (ttl > 0) feed.cache.set(url, { expires: feed.now + ttl, value });
    return value;
  },
}));

import { freshReferenceUsdPrice, referenceUsdPrice } from "./usePrices";

beforeEach(() => {
  feed.cache.clear();
  feed.ethUsd = 2_000;
  feed.fail = false;
});

describe("reference prices for the Multiply swap-cap anchor (#646)", () => {
  it("lets quote time use the cache, but reads the handoff price past it", async () => {
    await expect(referenceUsdPrice(MAINNET_TOKEN_ADDRESSES.ETH)).resolves.toBe(2_000);
    // The price moves between quote and handoff, inside the cache window.
    feed.ethUsd = 2_400;
    await expect(referenceUsdPrice(MAINNET_TOKEN_ADDRESSES.ETH)).resolves.toBe(2_000);
    await expect(freshReferenceUsdPrice(MAINNET_TOKEN_ADDRESSES.ETH)).resolves.toBe(2_400);
  });

  it("fails closed at handoff when no fresh price can be read", async () => {
    await expect(referenceUsdPrice(MAINNET_TOKEN_ADDRESSES.ETH)).resolves.toBe(2_000);
    feed.fail = true;
    // A cached quote-time price is not a fallback for the handoff read.
    await expect(freshReferenceUsdPrice(MAINNET_TOKEN_ADDRESSES.ETH)).resolves.toBeNull();
  });
});
