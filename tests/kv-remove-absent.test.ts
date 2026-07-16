/**
 * In-memory KV helper edge branches: reading a key that was never written falls
 * back to undefined, and removing a key (present or absent) leaves a subsequent
 * read undefined.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "../src/storage/kv";

describe("createMemoryStore remove/absent-key branches", () => {
  test("returns undefined for a key that was never set", async () => {
    const store = createMemoryStore();
    expect(await store.get("mc-wallet:missing")).toBeUndefined();
  });

  test("removes a stored key so a later read is undefined", async () => {
    const store = createMemoryStore();
    await store.set("mc-wallet:present", { ok: true });
    expect(await store.get("mc-wallet:present")).toEqual({ ok: true });

    await store.remove("mc-wallet:present");
    expect(await store.get("mc-wallet:present")).toBeUndefined();
  });

  test("removing an absent key is a no-op that does not throw", async () => {
    const store = createMemoryStore();
    await expect(store.remove("mc-wallet:never-set")).resolves.toBeUndefined();
    expect(await store.get("mc-wallet:never-set")).toBeUndefined();
  });
});
