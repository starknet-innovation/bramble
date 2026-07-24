/**
 * Vitest setup: register @testing-library cleanup after each test so mounted
 * components don't leak between cases.
 */
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Node exposes an incomplete experimental localStorage getter in some test
// runners, shadowing jsdom's implementation. Install a deterministic in-memory
// Storage boundary before components read public UI preferences.
const values = new Map<string, string>();
const localStorageDouble: Storage = {
  get length() {
    return values.size;
  },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => values.delete(key),
  setItem: (key, value) => values.set(key, String(value)),
};
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorageDouble,
});

afterEach(() => {
  cleanup();
  localStorageDouble.clear();
});
