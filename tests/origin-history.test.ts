/**
 * Origin first-seen history checks: the first-seen timestamp is written once
 * per origin and stays stable, persists across store instances, ignores
 * invalid origins, and drops corrupt stored entries on read.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "../src/storage/kv";
import {
  createOriginHistoryStore,
  memoryOriginHistory,
  ORIGIN_HISTORY_STORE_KEY,
} from "../src/storage/origin-history";

const makeClock = (start: number) => {
  let value = start;
  return {
    advance: (ms: number) => {
      value += ms;
    },
    now: () => value,
  };
};

describe("origin history store", () => {
  test("records the first-seen timestamp once and keeps it stable", async () => {
    const store = createMemoryStore();
    const clock = makeClock(5000);
    const history = createOriginHistoryStore({ now: clock.now, store });

    expect(await history.firstSeen("https://dapp.example")).toBeNull();
    expect(await history.record("https://dapp.example")).toBe(5000);

    clock.advance(10_000);
    expect(await history.record("https://dapp.example")).toBe(5000);
    expect(await history.firstSeen("https://dapp.example")).toBe(5000);
  });

  test("persists first-seen timestamps across store instances", async () => {
    const store = createMemoryStore();
    await createOriginHistoryStore({ now: () => 5000, store }).record("https://dapp.example");

    const reopened = createOriginHistoryStore({ now: () => 9999, store });
    expect(await reopened.firstSeen("https://dapp.example")).toBe(5000);
  });

  test("ignores invalid origins without persisting them", async () => {
    const store = createMemoryStore();
    const history = createOriginHistoryStore({ now: () => 42, store });

    expect(await history.record("not-an-origin")).toBe(42);
    expect(await history.firstSeen("not-an-origin")).toBeNull();
    expect(await store.get(ORIGIN_HISTORY_STORE_KEY)).toBeUndefined();
  });

  test("drops corrupt stored entries on read", async () => {
    const store = createMemoryStore();
    await store.set(ORIGIN_HISTORY_STORE_KEY, {
      "bad key": 1,
      "https://neg.example": -5,
      "https://ok.example": 42,
    });
    const history = createOriginHistoryStore({ now: () => 1, store });

    expect(await history.firstSeen("https://ok.example")).toBe(42);
    expect(await history.firstSeen("https://neg.example")).toBeNull();
  });

  test("memory history mirrors the persistent contract", async () => {
    const history = memoryOriginHistory(() => 7);

    expect(await history.firstSeen("https://x.example")).toBeNull();
    expect(await history.record("https://x.example")).toBe(7);
    expect(await history.record("https://x.example")).toBe(7);
    expect(history.now()).toBe(7);
  });
});
