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
  createBrowserSyncStore,
} from "../../apps/extension/src/browser-storage";

type MutableGlobal = { chrome?: unknown };
const globalWithChrome = globalThis as unknown as MutableGlobal;

afterEach(() => {
  globalWithChrome.chrome = undefined;
});

describe("createBrowserSyncStore", () => {
  test("throws when the sync storage area is unavailable", () => {
    globalWithChrome.chrome = { storage: {} };
    expect(() => createBrowserSyncStore()).toThrow(/chrome\.storage\.sync is unavailable/);
  });
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
    expect(await store.get("bramble:session")).toBeUndefined();

    await store.set("bramble:session", { unlocked: true });
    expect(writes).toEqual([{ "bramble:session": { unlocked: true } }]);
    expect(await store.get("bramble:session")).toEqual({ unlocked: true });

    await store.remove("bramble:session");
    expect(await store.get("bramble:session")).toBeUndefined();
  });
});
