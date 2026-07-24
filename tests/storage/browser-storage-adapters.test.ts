/**
 * Browser extension storage adapter factories: the unavailable-area throw paths
 * for the local and session stores, and the session store's happy path reading,
 * writing, and removing through an injected area (including the absent-key
 * fallback that returns undefined).
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  createBrowserLocalStore,
  createBrowserSessionStore,
} from "../../src/storage/browser-storage";

type MutableGlobal = { chrome?: unknown };
const globalWithChrome = globalThis as unknown as MutableGlobal;

afterEach(() => {
  globalWithChrome.chrome = undefined;
});

describe("createBrowserLocalStore", () => {
  test("throws when the local storage area is unavailable", () => {
    globalWithChrome.chrome = undefined;
    expect(() => createBrowserLocalStore()).toThrow(/chrome\.storage\.local is unavailable/);
  });

  test("throws when chrome exists but has no local area", () => {
    globalWithChrome.chrome = { storage: {} };
    expect(() => createBrowserLocalStore()).toThrow(/chrome\.storage\.local is unavailable/);
  });
});

describe("createBrowserSessionStore", () => {
  test("throws when the session storage area is unavailable", () => {
    globalWithChrome.chrome = { storage: {} };
    expect(() => createBrowserSessionStore()).toThrow(/chrome\.storage\.session is unavailable/);
  });

  test("reads, writes, and removes through the injected session area", async () => {
    const backing = new Map<string, unknown>();
    const writes: Array<Record<string, unknown>> = [];
    globalWithChrome.chrome = {
      storage: {
        session: {
          async get(key: string) {
            return backing.has(key) ? { [key]: backing.get(key) } : {};
          },
          async remove(key: string) {
            backing.delete(key);
          },
          async set(items: Record<string, unknown>) {
            writes.push(items);
            for (const [key, value] of Object.entries(items)) {
              backing.set(key, value);
            }
          },
        },
      },
    };

    const store = createBrowserSessionStore();
    // Absent key falls back to undefined rather than an object wrapper.
    expect(await store.get("mc-wallet:session")).toBeUndefined();

    await store.set("mc-wallet:session", { unlocked: true });
    expect(writes).toEqual([{ "mc-wallet:session": { unlocked: true } }]);
    expect(await store.get("mc-wallet:session")).toEqual({ unlocked: true });

    await store.remove("mc-wallet:session");
    expect(await store.get("mc-wallet:session")).toBeUndefined();
  });
});
