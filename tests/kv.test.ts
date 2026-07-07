/**
 * Key-value storage checks prove raw adapters reject lossy JSON writes.
 */
import { afterEach, expect, test } from "bun:test";

import { createBrowserLocalStore } from "../src/storage/browser-storage";
import { assertStorageKey, createMemoryStore } from "../src/storage/kv";

type FakeStorageArea = {
  readonly get: (key: string) => Promise<Record<string, unknown>>;
  readonly remove: (key: string) => Promise<void>;
  readonly set: (items: Record<string, unknown>) => Promise<void>;
};

type ChromeGlobal = typeof globalThis & {
  chrome?: {
    storage?: {
      local?: FakeStorageArea;
    };
  };
};

const chromeGlobal = globalThis as ChromeGlobal;
const originalChrome = chromeGlobal.chrome;

afterEach(() => {
  if (originalChrome === undefined) {
    delete chromeGlobal.chrome;
    return;
  }
  chromeGlobal.chrome = originalChrome;
});

test("memory store rejects lossy JSON writes", async () => {
  const store = createMemoryStore();

  await expect(store.set("mc-wallet:test", { amount: Number.NaN })).rejects.toThrow(
    "Invalid JSON value",
  );
});

test("memory store rejects unnamespaced keys", async () => {
  const store = createMemoryStore();

  await expect(store.set("vault", { ok: true })).rejects.toThrow("Storage key must be namespaced");
});

test("memory store snapshots JSON across the storage boundary", async () => {
  const store = createMemoryStore();
  const value = { nested: { ok: true } };

  await store.set("mc-wallet:test", value);
  value.nested.ok = false;
  const firstRead = (await store.get("mc-wallet:test")) as typeof value;
  firstRead.nested.ok = false;

  await expect(store.get("mc-wallet:test")).resolves.toEqual({ nested: { ok: true } });
});

test("storage keys require a lowercase wallet token path", () => {
  expect(() => assertStorageKey("mc-wallet:")).toThrow("Storage key must be namespaced");
  expect(() => assertStorageKey("mc-wallet:bad key")).toThrow("Storage key must be namespaced");
  expect(() => assertStorageKey("mc-wallet:vault")).not.toThrow();
});

test("browser store rejects lossy JSON before chrome writes", async () => {
  let writes = 0;
  chromeGlobal.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: undefined };
        },
        async remove(_key) {},
        async set(_items) {
          writes += 1;
        },
      },
    },
  };

  const store = createBrowserLocalStore();
  await expect(store.set("mc-wallet:test", { amount: Number.POSITIVE_INFINITY })).rejects.toThrow(
    "Invalid JSON value",
  );
  expect(writes).toBe(0);
});

test("browser store rejects unnamespaced keys before chrome writes", async () => {
  let writes = 0;
  chromeGlobal.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: undefined };
        },
        async remove(_key) {},
        async set(_items) {
          writes += 1;
        },
      },
    },
  };

  const store = createBrowserLocalStore();
  await expect(store.set("vault", { ok: true })).rejects.toThrow("Storage key must be namespaced");
  expect(writes).toBe(0);
});

test("browser store rejects unnamespaced reads before chrome access", async () => {
  let reads = 0;
  let removes = 0;
  chromeGlobal.chrome = {
    storage: {
      local: {
        async get(key) {
          reads += 1;
          return { [key]: undefined };
        },
        async remove(_key) {
          removes += 1;
        },
        async set(_items) {},
      },
    },
  };

  const store = createBrowserLocalStore();
  await expect(store.get("vault")).rejects.toThrow("Storage key must be namespaced");
  await expect(store.remove("vault")).rejects.toThrow("Storage key must be namespaced");
  expect(reads).toBe(0);
  expect(removes).toBe(0);
});
