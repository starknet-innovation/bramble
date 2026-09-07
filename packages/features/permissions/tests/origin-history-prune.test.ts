/**
 * Origin history overflow trimming: once more than MAX_ORIGINS (500) distinct
 * origins are recorded, the oldest-seen entries are pruned so the store stays
 * bounded while the most recently seen origins survive. Complements
 * origin-history.test.ts, which covers the dedup and validation paths.
 */
import { describe, expect, test } from "bun:test";
import {
  createOriginHistoryStore,
  ORIGIN_HISTORY_STORE_KEY,
} from "@bramble/permissions/origin-history";
import { createMemoryStore } from "@bramble/store/kv";

describe("origin history overflow trimming", () => {
  test("prunes the oldest origins once the 500-entry cap is exceeded", async () => {
    const store = createMemoryStore();
    let tick = 0;
    const history = createOriginHistoryStore({
      now: () => {
        tick += 1;
        return tick;
      },
      store,
    });

    // Record 502 distinct origins with strictly increasing first-seen times.
    for (let index = 0; index < 502; index += 1) {
      await history.record(`https://d${index}.example`);
    }

    const stored = (await store.get(ORIGIN_HISTORY_STORE_KEY)) as Record<string, number>;
    // The map is capped at MAX_ORIGINS.
    expect(Object.keys(stored)).toHaveLength(500);
    // The two earliest-seen origins were pruned; the newest survive.
    expect(await history.firstSeen("https://d0.example")).toBeNull();
    expect(await history.firstSeen("https://d1.example")).toBeNull();
    expect(await history.firstSeen("https://d501.example")).toBe(502);
    expect(await history.firstSeen("https://d2.example")).toBe(3);
  });

  test("keeps a duplicate origin's original first-seen timestamp", async () => {
    const store = createMemoryStore();
    let tick = 100;
    const history = createOriginHistoryStore({
      now: () => {
        tick += 100;
        return tick;
      },
      store,
    });

    const first = await history.record("https://dup.example");
    const second = await history.record("https://dup.example");
    expect(second).toBe(first);
    expect(await history.firstSeen("https://dup.example")).toBe(first);
  });
});
