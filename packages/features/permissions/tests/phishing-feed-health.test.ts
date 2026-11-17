/**
 * Live phishing feed health (issue 772): the old source returned 404 for a
 * long time and nothing showed it. The feed now reports how current its list
 * is, for support diagnostics, as counts and whole hours only.
 */
import { describe, expect, test } from "bun:test";
import {
  createPhishingFeed,
  PHISHING_FEED_STALE_AFTER_MS,
  type PhishingFeedResponse,
} from "@bramble/permissions/phishing-feed";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";

const HOUR = 60 * 60 * 1000;
const list = { blacklist: ["evil.example", "drainer.example"] };
const ok = (body: unknown): PhishingFeedResponse => ({ json: async () => body, ok: true });

// A fetch whose next outcome the test sets, and a clock it moves.
const harness = (store: KeyValueStore = createMemoryStore()) => {
  const state = { failing: false, time: 1_000 };
  const feed = createPhishingFeed({
    fetch: async () => {
      if (state.failing) throw new Error("unreachable");
      return ok(list);
    },
    now: () => state.time,
    store,
  });
  return { feed, state };
};

describe("phishing feed health", () => {
  test("before any list loads it is stale, with nothing counted", () => {
    expect(harness().feed.health()).toEqual({
      ageHours: null,
      cacheWriteFailed: false,
      consecutiveFailures: 0,
      domains: 0,
      stale: true,
    });
  });

  test("a fresh fetch is current; it turns stale once four refresh windows pass", async () => {
    const { feed, state } = harness();
    await feed.refresh();
    expect(feed.health()).toMatchObject({ ageHours: 0, domains: 2, stale: false });
    state.time += PHISHING_FEED_STALE_AFTER_MS;
    expect(feed.health()).toMatchObject({ ageHours: 24, stale: false });
    state.time += 1;
    expect(feed.health()).toMatchObject({ ageHours: 24, stale: true });
  });

  test("failed fetches are counted, keep the list's real age, and reset on success", async () => {
    const { feed, state } = harness();
    await feed.refresh();
    state.failing = true;
    state.time += 25 * HOUR;
    await feed.refresh();
    state.time += 7 * HOUR;
    await feed.refresh();
    expect(feed.health()).toMatchObject({
      ageHours: 32,
      consecutiveFailures: 2,
      domains: 2,
      stale: true,
    });
    state.failing = false;
    await feed.refresh();
    expect(feed.health()).toMatchObject({ ageHours: 0, consecutiveFailures: 0, stale: false });
  });

  test("a list restored from the cache reports the cache's age, not the worker's", async () => {
    const store = createMemoryStore();
    const first = harness(store);
    await first.feed.refresh();
    const restarted = harness(store);
    restarted.state.time = first.state.time + 3 * HOUR;
    restarted.state.failing = true;
    await restarted.feed.refresh();
    expect(restarted.feed.health()).toMatchObject({ ageHours: 3, domains: 2, stale: false });
  });

  test("a failed cache write is reported", async () => {
    const store = createMemoryStore();
    const refusing: KeyValueStore = {
      ...store,
      set: async () => {
        throw new Error("quota");
      },
    };
    const { feed } = harness(refusing);
    await feed.refresh();
    expect(feed.health()).toMatchObject({ cacheWriteFailed: true, domains: 2, stale: false });
  });
});
