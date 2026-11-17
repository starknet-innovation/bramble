/**
 * Audit #184: the phishing feed cache must survive the production storage
 * boundary. `createMemoryStore` applies the same `assertJsonValue` storage
 * budget as the browser-local adapter (4,096 array entries), so a real
 * list size written as one array is rejected there exactly as in production.
 * These cases pin that a large list persists in byte-budgeted chunks, that the
 * TTL applies across worker restarts, and that a torn or legacy cache fails
 * closed to no cache rather than a partial list.
 */
import { describe, expect, test } from "bun:test";
import {
  createPhishingFeed,
  DEFAULT_PHISHING_FEED_URL,
  type PhishingFeedResponse,
  parsePhishingFeed,
} from "@bramble/permissions/phishing-feed";
import {
  MAX_PHISHING_DOMAIN_CHARS,
  MAX_PHISHING_DOMAINS,
  PHISHING_FEED_STORE_KEY,
  phishingDomainChars,
  readPhishingCache,
  writePhishingCache,
} from "@bramble/permissions/phishing-feed-cache";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";

const okResponse = (body: unknown): PhishingFeedResponse => ({ json: async () => body, ok: true });
const bigList = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `evil${index}.example`);
const HOUR = 60 * 60 * 1000;

const countingFetch = (body: unknown) => {
  const calls = { count: 0 };
  return {
    calls,
    fetch: async (): Promise<PhishingFeedResponse> => {
      calls.count += 1;
      return okResponse(body);
    },
  };
};

const throwingFetch = () => {
  const calls = { count: 0 };
  return {
    calls,
    fetch: async (): Promise<PhishingFeedResponse> => {
      calls.count += 1;
      throw new Error("offline");
    },
  };
};

describe("phishing feed cache under the provider storage budget", () => {
  test("a 50,000-domain feed persists and serves the next worker within the TTL", async () => {
    const store = createMemoryStore();
    const first = createPhishingFeed({
      fetch: countingFetch({ blocklist: bigList(50_000) }).fetch,
      now: () => HOUR,
      store,
    });
    await first.refresh();
    expect(first.cacheWriteFailed()).toBe(false);

    // A cold worker whose fetch fails still enforces the cached list.
    const offline = throwingFetch();
    const second = createPhishingFeed({ fetch: offline.fetch, now: () => 2 * HOUR, store });
    await second.refresh();
    expect(second.blockedDomains().has("evil0.example")).toBe(true);
    expect(second.blockedDomains().has("evil49999.example")).toBe(true);
    expect(second.blockedDomains().size).toBe(50_000);
    expect(offline.calls.count).toBe(0);

    // And a third, still inside the TTL, never touches the network.
    const third = throwingFetch();
    const feed = createPhishingFeed({ fetch: third.fetch, now: () => 3 * HOUR, store });
    await feed.refresh();
    expect(third.calls.count).toBe(0);
    expect(feed.blockedDomains().size).toBe(50_000);
  });

  test("long entries are chunked by byte budget, not by count", async () => {
    const store = createMemoryStore();
    const label = "a".repeat(60);
    const long = Array.from({ length: 6_000 }, (_, index) =>
      `${label}.${label}.${label}.${label}.x${index}.example`.slice(-253),
    );
    const domains = parsePhishingFeed({ blocklist: long }) ?? [];
    expect(domains.length).toBe(6_000);
    await writePhishingCache(store, { domains, fetchedAt: 1, source: DEFAULT_PHISHING_FEED_URL });
    const cached = await readPhishingCache(store, DEFAULT_PHISHING_FEED_URL, 1);
    expect(cached?.domains.length).toBe(6_000);
  });

  test("keeps every domain of a list the size of today's eth-phishing-detect", async () => {
    // About 110,000 valid entries in October 2026, past the old 100,000 cap
    // (issue 772). Every one must survive parsing and a cache round trip.
    const store = createMemoryStore();
    const domains =
      parsePhishingFeed({ blacklist: bigList(120_000), whitelist: ["ok.example"] }) ?? [];
    expect(domains.length).toBe(120_000);
    await writePhishingCache(store, { domains, fetchedAt: 1, source: DEFAULT_PHISHING_FEED_URL });
    expect((await readPhishingCache(store, DEFAULT_PHISHING_FEED_URL, 1))?.domains.length).toBe(
      120_000,
    );
  });

  test("a list past the cap keeps exactly the cap", () => {
    expect(parsePhishingFeed({ blocklist: bigList(MAX_PHISHING_DOMAINS + 5) })?.length).toBe(
      MAX_PHISHING_DOMAINS,
    );
  });

  test("a list past the size budget keeps only what fits, so storage stays shared", () => {
    // 20,000 valid 253-character names is about 5 MiB, past the 4 MiB budget.
    const label = "a".repeat(60);
    const long = Array.from({ length: 20_000 }, (_, index) =>
      `${label}.${label}.${label}.${label}.x${index}.example`.slice(-253),
    );
    const kept = parsePhishingFeed({ blocklist: long }) ?? [];
    const chars = kept.reduce((total, domain) => total + phishingDomainChars(domain), 0);
    expect(kept.length).toBeLessThan(long.length);
    expect(chars).toBeLessThanOrEqual(MAX_PHISHING_DOMAIN_CHARS);
    expect(chars + phishingDomainChars(long[kept.length] ?? "")).toBeGreaterThan(
      MAX_PHISHING_DOMAIN_CHARS,
    );
  });

  test("the cap fits the chunk budget even when every name is 253 characters", async () => {
    const store = createMemoryStore();
    const label = "a".repeat(60);
    const domains = Array.from({ length: MAX_PHISHING_DOMAINS }, (_, index) =>
      `${label}.${label}.${label}.${label}.x${index}.example`.slice(-253),
    );
    await writePhishingCache(store, { domains, fetchedAt: 1, source: DEFAULT_PHISHING_FEED_URL });
    expect((await readPhishingCache(store, DEFAULT_PHISHING_FEED_URL, 1))?.domains.length).toBe(
      MAX_PHISHING_DOMAINS,
    );
  });

  test("names longer than a DNS name are rejected at parse time", () => {
    const tooLong = `${"a".repeat(250)}.com`;
    expect(parsePhishingFeed({ blocklist: [tooLong, "ok.example"] })).toEqual(["ok.example"]);
  });

  test("a missing middle chunk yields an empty snapshot, not a partial one", async () => {
    const store = createMemoryStore();
    await writePhishingCache(store, {
      domains: bigList(12_000),
      fetchedAt: 1,
      source: DEFAULT_PHISHING_FEED_URL,
    });
    await store.remove(`${PHISHING_FEED_STORE_KEY}:chunk:1`);
    const feed = createPhishingFeed({ fetch: throwingFetch().fetch, now: () => 2, store });
    expect((await feed.refresh()).size).toBe(0);
  });

  test("a chunk from another generation (torn write) fails the whole cache", async () => {
    const store = createMemoryStore();
    await writePhishingCache(store, {
      domains: bigList(12_000),
      fetchedAt: 1,
      source: DEFAULT_PHISHING_FEED_URL,
    });
    const generation2 = createMemoryStore();
    await writePhishingCache(generation2, {
      domains: bigList(12_000),
      fetchedAt: 2,
      source: DEFAULT_PHISHING_FEED_URL,
    });
    const key = `${PHISHING_FEED_STORE_KEY}:chunk:0`;
    await store.set(key, (await generation2.get(key)) as never);
    expect(await readPhishingCache(store, DEFAULT_PHISHING_FEED_URL, 3)).toBeNull();
  });

  test("a legacy v1 single-record cache is ignored", async () => {
    const store = createMemoryStore();
    await store.set(PHISHING_FEED_STORE_KEY, {
      domains: ["cached-bad.com"],
      fetchedAt: 1,
      schemaVersion: 1,
      source: DEFAULT_PHISHING_FEED_URL,
    });
    expect(await readPhishingCache(store, DEFAULT_PHISHING_FEED_URL, 2)).toBeNull();
  });

  test("a smaller later generation removes the stale trailing chunks", async () => {
    const store = createMemoryStore();
    await writePhishingCache(store, {
      domains: bigList(12_000),
      fetchedAt: 1,
      source: DEFAULT_PHISHING_FEED_URL,
    });
    expect(await store.get(`${PHISHING_FEED_STORE_KEY}:chunk:2`)).toBeDefined();
    await writePhishingCache(store, {
      domains: ["only.example"],
      fetchedAt: 2,
      source: DEFAULT_PHISHING_FEED_URL,
    });
    expect(await store.get(`${PHISHING_FEED_STORE_KEY}:chunk:1`)).toBeUndefined();
    expect(await store.get(`${PHISHING_FEED_STORE_KEY}:chunk:2`)).toBeUndefined();
    expect((await readPhishingCache(store, DEFAULT_PHISHING_FEED_URL, 3))?.domains).toEqual([
      "only.example",
    ]);
  });

  test("a quota failure on write is observable and the fetched list stays live", async () => {
    const inner = createMemoryStore();
    const store: KeyValueStore = {
      get: inner.get,
      remove: inner.remove,
      async set(key, value) {
        if (key.endsWith(":chunk:1")) {
          throw new Error("QUOTA_BYTES quota exceeded");
        }
        await inner.set(key, value);
      },
    };
    const feed = createPhishingFeed({
      fetch: countingFetch({ blocklist: bigList(12_000) }).fetch,
      now: () => 1,
      store,
    });
    expect((await feed.refresh()).size).toBe(12_000);
    expect(feed.cacheWriteFailed()).toBe(true);
    expect(await readPhishingCache(store, DEFAULT_PHISHING_FEED_URL, 2)).toBeNull();
  });
});
