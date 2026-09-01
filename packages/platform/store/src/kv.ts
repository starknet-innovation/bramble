/**
 * Minimal key-value storage boundary for browser storage and tests.
 */
import { WalletError } from "@bramble/core/errors";
import { isJson, type Json } from "@bramble/core/json";

const STORAGE_KEY_PATTERN = /^mc-wallet:[a-z0-9]+(?:[-:][a-z0-9]+)*$/;

/**
 * Minimal async key-value store abstraction used by encrypted storage.
 */
export type KeyValueStore = {
  readonly get: (key: string) => Promise<unknown>;
  readonly remove: (key: string) => Promise<void>;
  readonly set: (key: string, value: Json) => Promise<void>;
};

/**
 * Throws when a storage key is outside the wallet namespace.
 */
export function assertStorageKey(key: string): void {
  if (!STORAGE_KEY_PATTERN.test(key)) {
    throw new WalletError("Storage key must be namespaced");
  }
}

/**
 * Throws when a storage write would serialize as lossy JSON.
 */
export function assertJsonValue(value: unknown): asserts value is Json {
  if (!isJson(value)) {
    throw new WalletError("Invalid JSON value");
  }
}

const cloneJson = (value: Json): Json => structuredClone(value) as Json;

/**
 * Creates an in-memory key-value store for deterministic tests.
 */
export const createMemoryStore = (): KeyValueStore => {
  const values = new Map<string, Json>();

  return {
    async get(key) {
      assertStorageKey(key);
      const value = values.get(key);
      return value === undefined ? undefined : cloneJson(value);
    },
    async remove(key) {
      assertStorageKey(key);
      values.delete(key);
    },
    async set(key, value) {
      assertStorageKey(key);
      assertJsonValue(value);
      values.set(key, cloneJson(value));
    },
  };
};
