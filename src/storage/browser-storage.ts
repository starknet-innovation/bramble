/**
 * Browser extension storage adapter kept behind the generic key-value boundary.
 */
import type { Json } from "../shared/json";
import { assertJsonValue, assertStorageKey, type KeyValueStore } from "./kv";

type StorageArea = {
  readonly get: (key: string) => Promise<Record<string, unknown>>;
  readonly remove: (key: string) => Promise<void>;
  readonly set: (items: Record<string, Json>) => Promise<void>;
};

type ExtensionGlobal = typeof globalThis & {
  readonly chrome?: {
    readonly storage?: {
      readonly local?: StorageArea;
      readonly session?: StorageArea;
    };
  };
};

const createAreaStore = (storage: StorageArea): KeyValueStore => ({
  async get(key) {
    assertStorageKey(key);
    return (await storage.get(key))[key];
  },
  async remove(key) {
    assertStorageKey(key);
    await storage.remove(key);
  },
  async set(key, value) {
    assertStorageKey(key);
    assertJsonValue(value);
    await storage.set({ [key]: value });
  },
});

/**
 * Creates the only production adapter for chrome.storage.local access.
 */
export const createBrowserLocalStore = (): KeyValueStore => {
  const storage = (globalThis as ExtensionGlobal).chrome?.storage?.local;

  if (!storage) {
    throw new Error("chrome.storage.local is unavailable");
  }

  return createAreaStore(storage);
};

/**
 * Creates the only production adapter for chrome.storage.session access.
 * Session storage lives in memory, survives service-worker restarts, and is
 * cleared when the browser exits.
 */
export const createBrowserSessionStore = (): KeyValueStore => {
  const storage = (globalThis as ExtensionGlobal).chrome?.storage?.session;

  if (!storage) {
    throw new Error("chrome.storage.session is unavailable");
  }

  return createAreaStore(storage);
};
