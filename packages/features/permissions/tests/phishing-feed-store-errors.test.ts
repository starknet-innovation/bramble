/**
 * createPhishingFeed swallows storage failures rather than letting them break a
 * refresh: a rejecting store.get is treated as "no cache" and a rejecting
 * store.set still lets the freshly fetched list become the live snapshot. These
 * exercise the two best-effort .catch handlers on the storage boundary.
 */
import { describe, expect, test } from "bun:test";
import { createPhishingFeed, type PhishingFeedResponse } from "@bramble/permissions/phishing-feed";
import type { KeyValueStore } from "@bramble/store/kv";

const okResponse = (body: unknown): PhishingFeedResponse => ({ json: async () => body, ok: true });

// A store whose reads and writes reject, so the feed must fall through its
// best-effort catch handlers instead of surfacing the error.
const failingStore = (): { store: KeyValueStore; sets: number; gets: number } => {
  const counts = { gets: 0, sets: 0 };
  const store = {
    async get() {
      counts.gets += 1;
      throw new Error("storage read failed");
    },
    async set() {
      counts.sets += 1;
      throw new Error("storage write failed");
    },
    async remove() {},
  } as unknown as KeyValueStore;
  return {
    get store() {
      return store;
    },
    get gets() {
      return counts.gets;
    },
    get sets() {
      return counts.sets;
    },
  };
};

describe("createPhishingFeed storage failures", () => {
  test("a rejecting store still yields the freshly fetched snapshot", async () => {
    const failing = failingStore();
    const feed = createPhishingFeed({
      fetch: async () => okResponse({ blocklist: ["feed-bad.com"] }),
      now: () => 1_000,
      store: failing.store,
    });

    const domains = await feed.refresh();

    // store.get rejected (treated as no cache) and store.set rejected (swallowed),
    // yet the fetched list is promoted to the live snapshot.
    expect([...domains]).toEqual(["feed-bad.com"]);
    expect([...feed.blockedDomains()]).toEqual(["feed-bad.com"]);
    expect(failing.gets).toBe(1);
    expect(failing.sets).toBe(1);
  });
});
