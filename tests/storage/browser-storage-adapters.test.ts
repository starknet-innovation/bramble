/**
 * Browser extension storage adapter factories: the unavailable-area throw paths
 * for the local and session stores, the session store's happy path reading,
 * writing, and removing through an injected area (including the absent-key
 * fallback that returns undefined), and the namespace the adapters bind to.
 *
 * That last one is load-bearing on Firefox, which serves the promise-based API
 * as `browser` and keeps `chrome` only as a callback-style alias: an adapter
 * bound to `chrome` there would await results that never arrive and read an
 * empty vault, which to the user is indistinguishable from losing their
 * accounts.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { JSON_BUDGETS } from "@bramble/core/json";
import {
  createBrowserLocalStore,
  createBrowserSessionStore,
  createBrowserSyncStore,
} from "../../apps/extension/src/browser-storage";

type MutableGlobal = { browser?: unknown; chrome?: unknown };
const globalWithChrome = globalThis as unknown as MutableGlobal;

afterEach(() => {
  globalWithChrome.chrome = undefined;
  globalWithChrome.browser = undefined;
});

describe("extension API namespace", () => {
  test("binds to the promise-based browser namespace when both are present", async () => {
    const chromeArea = {
      get: async () => ({ "bramble:namespace": "chrome" }),
      remove: async () => {},
      set: async () => {},
    };
    const browserArea = {
      get: async () => ({ "bramble:namespace": "browser" }),
      remove: async () => {},
      set: async () => {},
    };
    globalWithChrome.chrome = { storage: { local: chromeArea } };
    globalWithChrome.browser = { storage: { local: browserArea } };
    expect(await createBrowserLocalStore().get("bramble:namespace")).toBe("browser");
  });

  test("falls back to chrome where no browser namespace exists", async () => {
    const chromeArea = {
      get: async () => ({ "bramble:namespace": "chrome" }),
      remove: async () => {},
      set: async () => {},
    };
    globalWithChrome.chrome = { storage: { local: chromeArea } };
    expect(await createBrowserLocalStore().get("bramble:namespace")).toBe("chrome");
  });
});

describe("createBrowserSyncStore", () => {
  test("throws when the sync storage area is unavailable", () => {
    globalWithChrome.chrome = { storage: {} };
    expect(() => createBrowserSyncStore()).toThrow(/browser storage\.sync is unavailable/);
  });
});

describe("createBrowserLocalStore", () => {
  test("throws when the local storage area is unavailable", () => {
    globalWithChrome.chrome = undefined;
    expect(() => createBrowserLocalStore()).toThrow(/browser storage\.local is unavailable/);
  });

  test("throws when chrome exists but has no local area", () => {
    globalWithChrome.chrome = { storage: {} };
    expect(() => createBrowserLocalStore()).toThrow(/browser storage\.local is unavailable/);
  });
});

describe("createBrowserSessionStore", () => {
  test("throws when the session storage area is unavailable", () => {
    globalWithChrome.chrome = { storage: {} };
    expect(() => createBrowserSessionStore()).toThrow(/browser storage\.session is unavailable/);
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

// Only the vault envelope keys get the larger at-rest budget (Sherlock 261):
// every other key stays on the provider budget, so no other value can grow
// toward the browser's shared storage quota.
describe("browser local store write budget", () => {
  test("admits a ciphertext-sized value under the vault key only", async () => {
    const written: Record<string, unknown> = {};
    globalWithChrome.chrome = {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: written[key] }),
          remove: async () => undefined,
          set: async (items: Record<string, unknown>) => void Object.assign(written, items),
        },
      },
    };
    const store = createBrowserLocalStore();
    const ciphertextSized = "A".repeat(JSON_BUDGETS.provider.maxStringLength + 1);
    await store.set("bramble:vault", { ciphertext: ciphertextSized });
    expect(written["bramble:vault"]).toEqual({ ciphertext: ciphertextSized });
    await expect(store.set("bramble:preferences", { blob: ciphertextSized })).rejects.toThrow(
      "Invalid JSON value",
    );
    expect(written["bramble:preferences"]).toBeUndefined();
  });
});
