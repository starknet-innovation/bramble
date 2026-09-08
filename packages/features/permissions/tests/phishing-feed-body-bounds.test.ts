/**
 * MCW-V09-122: the phishing feed reads a body from a configurable third-party
 * source, so a compromised or hostile source must not be able to stream the
 * worker out of memory. These cases pin that an over-budget body is refused
 * before it is parsed and that the previously cached protection survives the
 * refusal — a size cap must never be a way to blank the blocklist — and that
 * the request itself carries a deadline and no cookies or referrer.
 */
import { describe, expect, test } from "bun:test";
import { type BoundedHttpFetch, HTTP_BODY_LIMITS } from "@bramble/core/http-json";
import {
  createPhishingFeed,
  DEFAULT_PHISHING_FEED_URL,
  PHISHING_FEED_STORE_KEY,
} from "@bramble/permissions/phishing-feed";
import { createMemoryStore } from "@bramble/store/kv";

const CHUNK_BYTES = 256 * 1024;

// A source that keeps streaming padding instead of ever closing the body.
const endlessFeed = (): { readonly emitted: { bytes: number }; readonly response: Response } => {
  const emitted = { bytes: 0 };
  const padding = new TextEncoder().encode(`{"blocklist":["${"a".repeat(CHUNK_BYTES)}`);
  return {
    emitted,
    response: new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          emitted.bytes += padding.byteLength;
          controller.enqueue(padding);
        },
      }),
    ),
  };
};

const cachedFeed = (fetched: () => Response) =>
  createPhishingFeed({
    fetch: async () => fetched(),
    now: () => 10_000,
    source: DEFAULT_PHISHING_FEED_URL,
    store: createMemoryStore(),
    ttlMs: 1,
  });

describe("phishing feed response bounds", () => {
  test("cuts off an endless feed body instead of parsing it", async () => {
    const { emitted, response } = endlessFeed();
    const feed = cachedFeed(() => response);
    expect([...(await feed.refresh())]).toEqual([]);
    expect(emitted.bytes).toBeLessThanOrEqual(HTTP_BODY_LIMITS.phishingFeed + 2 * CHUNK_BYTES);
  });

  test("keeps the cached blocklist when the source answers over budget", async () => {
    const store = createMemoryStore();
    await store.set(PHISHING_FEED_STORE_KEY, {
      domains: ["evil.example"],
      fetchedAt: 1,
      schemaVersion: 1,
      source: DEFAULT_PHISHING_FEED_URL,
    });
    const feed = createPhishingFeed({
      fetch: async () =>
        new Response('{"blocklist":[]}', {
          headers: { "content-length": String(64 * 1024 * 1024) },
        }),
      now: () => 10_000,
      source: DEFAULT_PHISHING_FEED_URL,
      store,
      ttlMs: 1,
    });
    expect([...(await feed.refresh())]).toEqual(["evil.example"]);
  });

  test("still reads a normal feed body", async () => {
    const feed = cachedFeed(() => new Response(JSON.stringify({ blocklist: ["evil.example"] })));
    expect([...(await feed.refresh())]).toEqual(["evil.example"]);
  });

  test("sends a deadline and withholds cookies and referrer", async () => {
    const inits: RequestInit[] = [];
    const fetch: BoundedHttpFetch = async (_url, init) => {
      inits.push(init);
      return new Response('{"blocklist":[]}');
    };
    await createPhishingFeed({
      fetch,
      now: () => 10_000,
      source: DEFAULT_PHISHING_FEED_URL,
      store: createMemoryStore(),
      ttlMs: 1,
    }).refresh();
    expect(inits).toHaveLength(1);
    expect(inits[0]?.credentials).toBe("omit");
    expect(inits[0]?.redirect).toBe("error");
    expect(inits[0]?.referrerPolicy).toBe("no-referrer");
    expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(inits[0]?.signal?.aborted).toBe(false);
  });
});
