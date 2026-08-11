/**
 * Live phishing feed (issue #34): wire-format parsing, the TTL-gated cache and
 * refresh, the unreachable -> cached -> bundled-baseline fallback chain, and the
 * dynamic-blocklist decisioning (isBlockedOrigin / originInsights / OriginGuard)
 * that consumes the feed snapshot on top of the always-on baseline list.
 */
import { describe, expect, test } from "bun:test";
import {
  createOriginGuard,
  isBlockedOrigin,
  originInsights,
} from "@mc-wallet/permissions/blocklist";
import {
  createPhishingFeed,
  DEFAULT_PHISHING_FEED_URL,
  PHISHING_FEED_STORE_KEY,
  type PhishingFeedResponse,
  parsePhishingFeed,
} from "@mc-wallet/permissions/phishing-feed";
import { createMemoryStore } from "@mc-wallet/store/kv";

const okResponse = (body: unknown): PhishingFeedResponse => ({
  json: async () => body,
  ok: true,
});

// A fetch stub that records calls and yields a scripted sequence of outcomes.
const scriptedFetch = (outcomes: readonly (PhishingFeedResponse | Error)[]) => {
  let index = 0;
  const calls: string[] = [];
  const fetch = async (url: string): Promise<PhishingFeedResponse> => {
    calls.push(url);
    const outcome = outcomes[Math.min(index, outcomes.length - 1)];
    index += 1;
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome as PhishingFeedResponse;
  };
  return { calls, fetch };
};

describe("parsePhishingFeed", () => {
  test("parses, lowercases, strips trailing dots, and de-duplicates the blocklist", () => {
    expect(parsePhishingFeed({ blocklist: ["Evil.COM", "evil.com.", "phish.example"] })).toEqual([
      "evil.com",
      "phish.example",
    ]);
  });

  test("accepts the eth-phishing-detect `blacklist` key as an alias", () => {
    expect(parsePhishingFeed({ blacklist: ["drainer.xyz"], fuzzylist: ["x"] })).toEqual([
      "drainer.xyz",
    ]);
  });

  test("drops non-string and malformed entries but keeps valid domains", () => {
    expect(
      parsePhishingFeed({ blocklist: ["good.com", 42, "no-dot", "bad_domain.com", "a.b.c"] }),
    ).toEqual(["good.com", "a.b.c"]);
  });

  test("treats a well-formed but empty list as valid (empty), not a failure", () => {
    expect(parsePhishingFeed({ blocklist: [] })).toEqual([]);
  });

  test("returns null when the payload is not the expected shape", () => {
    expect(parsePhishingFeed(null)).toBeNull();
    expect(parsePhishingFeed({ nope: true })).toBeNull();
    expect(parsePhishingFeed({ blocklist: "not-an-array" })).toBeNull();
  });
});

describe("createPhishingFeed refresh + cache", () => {
  test("fetches from the default source, caches it, and exposes the snapshot", async () => {
    const store = createMemoryStore();
    const { calls, fetch } = scriptedFetch([okResponse({ blocklist: ["feed-bad.com"] })]);
    const feed = createPhishingFeed({ fetch, now: () => 1_000, store });

    const domains = await feed.refresh();

    expect(calls).toEqual([DEFAULT_PHISHING_FEED_URL]);
    expect([...domains]).toEqual(["feed-bad.com"]);
    expect([...feed.blockedDomains()]).toEqual(["feed-bad.com"]);
    expect(await store.get(PHISHING_FEED_STORE_KEY)).toEqual({
      domains: ["feed-bad.com"],
      fetchedAt: 1_000,
      schemaVersion: 1,
      source: DEFAULT_PHISHING_FEED_URL,
    });
  });

  test("serves a fresh cache without hitting the network", async () => {
    const store = createMemoryStore();
    await store.set(PHISHING_FEED_STORE_KEY, {
      domains: ["cached-bad.com"],
      fetchedAt: 10_000,
      schemaVersion: 1,
      source: DEFAULT_PHISHING_FEED_URL,
    });
    const { calls, fetch } = scriptedFetch([new Error("network must not be used")]);
    // now is 1min after fetchedAt, well inside the 6h TTL.
    const feed = createPhishingFeed({ fetch, now: () => 10_000 + 60_000, store });

    expect([...(await feed.refresh())]).toEqual(["cached-bad.com"]);
    expect(calls).toEqual([]);
  });

  test("refetches once the cache is older than the TTL", async () => {
    const store = createMemoryStore();
    await store.set(PHISHING_FEED_STORE_KEY, {
      domains: ["stale.com"],
      fetchedAt: 0,
      schemaVersion: 1,
      source: DEFAULT_PHISHING_FEED_URL,
    });
    const { calls, fetch } = scriptedFetch([okResponse({ blocklist: ["fresh.com"] })]);
    const sevenHours = 7 * 60 * 60 * 1000;
    const feed = createPhishingFeed({ fetch, now: () => sevenHours, store });

    expect([...(await feed.refresh())]).toEqual(["fresh.com"]);
    expect(calls.length).toBe(1);
  });

  test.each([
    ["unknown field", { extra: true }],
    ["wrong schema version", { schemaVersion: 2 }],
    ["wrong source", { source: "https://attacker.example/list.json" }],
    ["future timestamp", { fetchedAt: 20_001 }],
    ["malformed domain", { domains: ["good.example", "com"] }],
    ["duplicate domain", { domains: ["bad.example", "BAD.EXAMPLE"] }],
  ])("rejects a cache with %s and refreshes from the authenticated source", async (_, override) => {
    const store = createMemoryStore();
    await store.set(PHISHING_FEED_STORE_KEY, {
      domains: ["cached-bad.com"],
      fetchedAt: 10_000,
      schemaVersion: 1,
      source: DEFAULT_PHISHING_FEED_URL,
      ...override,
    });
    const { calls, fetch } = scriptedFetch([okResponse({ blocklist: ["fresh-safe.example"] })]);
    const feed = createPhishingFeed({ fetch, now: () => 20_000, store });

    expect([...(await feed.refresh())]).toEqual(["fresh-safe.example"]);
    expect(calls).toEqual([DEFAULT_PHISHING_FEED_URL]);
    expect([...feed.blockedDomains()]).not.toContain("cached-bad.com");
  });
});

describe("createPhishingFeed fallback chain (fail-safe)", () => {
  test("unreachable source keeps the last cached list", async () => {
    const store = createMemoryStore();
    await store.set(PHISHING_FEED_STORE_KEY, {
      domains: ["cached-bad.com"],
      fetchedAt: 0,
      schemaVersion: 1,
      source: DEFAULT_PHISHING_FEED_URL,
    });
    const sevenHours = 7 * 60 * 60 * 1000;
    const { fetch } = scriptedFetch([new Error("offline")]);
    const feed = createPhishingFeed({ fetch, now: () => sevenHours, store });

    expect([...(await feed.refresh())]).toEqual(["cached-bad.com"]);
  });

  test("a non-ok or malformed response also falls back to the cache", async () => {
    const store = createMemoryStore();
    await store.set(PHISHING_FEED_STORE_KEY, {
      domains: ["cached-bad.com"],
      fetchedAt: 0,
      schemaVersion: 1,
      source: DEFAULT_PHISHING_FEED_URL,
    });
    const sevenHours = 7 * 60 * 60 * 1000;
    const feed = createPhishingFeed({
      fetch: async () => ({ json: async () => ({ nope: true }), ok: false }),
      now: () => sevenHours,
      store,
    });

    expect([...(await feed.refresh())]).toEqual(["cached-bad.com"]);
  });

  test("with no cache and an unreachable source the snapshot is empty (baseline still applies)", async () => {
    const store = createMemoryStore();
    const { fetch } = scriptedFetch([new Error("offline")]);
    const feed = createPhishingFeed({ fetch, now: () => 0, store });

    expect([...(await feed.refresh())]).toEqual([]);
    // The bundled baseline list is enforced independently of the feed.
    expect(isBlockedOrigin("https://starknet-airdrop.com", feed.blockedDomains())).toBe(true);
  });
});

describe("dynamic blocklist decisioning", () => {
  const feedSet = new Set(["starknet-rewards-2026.com"]);

  test("isBlockedOrigin flags a feed domain and its subdomains, misses others", () => {
    expect(isBlockedOrigin("https://starknet-rewards-2026.com", feedSet)).toBe(true);
    expect(isBlockedOrigin("https://login.starknet-rewards-2026.com", feedSet)).toBe(true);
    expect(isBlockedOrigin("https://legit-dapp.xyz", feedSet)).toBe(false);
  });

  test("the bundled baseline still blocks even with an empty feed set", () => {
    expect(isBlockedOrigin("https://braavos-airdrop.com", new Set())).toBe(true);
  });

  test("originInsights reports a feed domain as blocked with the blocklist warning", () => {
    const insight = originInsights("https://starknet-rewards-2026.com", {}, feedSet);
    expect(insight.blocked).toBe(true);
    expect(insight.warnings.some((warning) => warning.includes("blocklist"))).toBe(true);
  });

  test("an OriginGuard reads the live accessor so a refresh takes effect immediately", () => {
    let current: ReadonlySet<string> = new Set();
    const guard = createOriginGuard(() => current);
    expect(guard.isBlocked("https://starknet-rewards-2026.com")).toBe(false);
    current = feedSet;
    expect(guard.isBlocked("https://starknet-rewards-2026.com")).toBe(true);
    // Baseline coverage does not depend on the accessor.
    expect(guard.isBlocked("https://starknet-airdrop.com")).toBe(true);
  });
});
