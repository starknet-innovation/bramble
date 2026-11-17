/**
 * Persisted flag state and the install bucket: malformed records read as
 * nothing stored, the bucket is drawn once, and store failures never throw.
 */
import { describe, expect, test } from "bun:test";
import {
  EMPTY_FLAG_STATE,
  FEATURE_FLAG_BUCKET_KEY,
  FEATURE_FLAG_STORE_KEY,
  readFlagState,
  readOrCreateFlagBucket,
  writeFlagState,
} from "@bramble/flags/state";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";

const NOW = 1_000_000;

const failingStore: KeyValueStore = {
  get: async () => {
    throw new Error("down");
  },
  remove: async () => undefined,
  set: async () => {
    throw new Error("down");
  },
};

describe("flag state", () => {
  test("round-trips a written state", async () => {
    const store = createMemoryStore();
    const state = { checkedAt: NOW, document: "{}", sequence: 7 };
    await writeFlagState(store, state);
    expect(await readFlagState(store, NOW)).toEqual(state);
  });

  test.each([
    ["absent", undefined],
    ["wrong version", { checkedAt: 0, document: null, schemaVersion: 2, sequence: 0 }],
    ["extra field", { checkedAt: 0, document: null, extra: 1, schemaVersion: 1, sequence: 0 }],
    ["future checkedAt", { checkedAt: NOW + 1, document: null, schemaVersion: 1, sequence: 0 }],
    ["negative sequence", { checkedAt: 0, document: null, schemaVersion: 1, sequence: -1 }],
    [
      "oversized document",
      { checkedAt: 0, document: "x".repeat(16_385), schemaVersion: 1, sequence: 1 },
    ],
  ])("reads %s as empty", async (_label, value) => {
    const store = createMemoryStore();
    if (value !== undefined) {
      await store.set(FEATURE_FLAG_STORE_KEY, value);
    }
    expect(await readFlagState(store, NOW)).toEqual(EMPTY_FLAG_STATE);
  });

  test("a failing store reads as empty and swallows writes", async () => {
    expect(await readFlagState(failingStore, NOW)).toEqual(EMPTY_FLAG_STATE);
    await writeFlagState(failingStore, EMPTY_FLAG_STATE);
  });
});

describe("install bucket", () => {
  test("is drawn once and then reused", async () => {
    const store = createMemoryStore();
    let draws = 0;
    const draw = () => {
      draws += 1;
      return 4242;
    };
    expect(await readOrCreateFlagBucket(store, draw)).toBe(4242);
    expect(await readOrCreateFlagBucket(store, draw)).toBe(4242);
    expect(draws).toBe(1);
    expect(await store.get(FEATURE_FLAG_BUCKET_KEY)).toBe(4242);
  });

  test.each([10_000, -1, 1.5, "7"])("replaces an invalid stored bucket %p", async (stored) => {
    const store = createMemoryStore();
    await store.set(FEATURE_FLAG_BUCKET_KEY, stored);
    expect(await readOrCreateFlagBucket(store, () => 9)).toBe(9);
  });

  test("refuses an out-of-range draw instead of storing it", async () => {
    const store = createMemoryStore();
    expect(await readOrCreateFlagBucket(store, () => 10_000)).toBeNull();
    expect(await store.get(FEATURE_FLAG_BUCKET_KEY)).toBeUndefined();
  });

  test("still returns a fresh draw when the store is down", async () => {
    expect(await readOrCreateFlagBucket(failingStore, () => 3)).toBe(3);
  });
});
