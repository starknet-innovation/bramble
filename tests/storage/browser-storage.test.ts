/**
 * Verifies persistent and session storage access lockdowns that keep direct
 * store access out of untrusted content-script contexts.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { hardenLocalAccess, hardenSessionAccess } from "../../src/storage/browser-storage";

type MutableGlobal = { chrome?: unknown };
const globalWithChrome = globalThis as unknown as MutableGlobal;

afterEach(() => {
  globalWithChrome.chrome = undefined;
});

describe("hardenLocalAccess", () => {
  test("reports no lockdown when the local area is unavailable", async () => {
    globalWithChrome.chrome = { storage: {} };
    expect(await hardenLocalAccess()).toBe(false);
  });

  test("restricts persistent stores to trusted extension contexts", async () => {
    const calls: unknown[] = [];
    globalWithChrome.chrome = {
      storage: {
        local: {
          async setAccessLevel(options: unknown) {
            calls.push(options);
          },
        },
      },
    };

    expect(await hardenLocalAccess()).toBe(true);
    expect(calls).toEqual([{ accessLevel: "TRUSTED_CONTEXTS" }]);
  });
});

describe("hardenSessionAccess", () => {
  test("reports no lockdown when the session area is unavailable", async () => {
    globalWithChrome.chrome = undefined;
    expect(await hardenSessionAccess()).toBe(false);
  });

  test("restricts the session area to trusted extension contexts", async () => {
    const calls: unknown[] = [];
    globalWithChrome.chrome = {
      storage: {
        session: {
          async setAccessLevel(options: unknown) {
            calls.push(options);
          },
        },
      },
    };

    expect(await hardenSessionAccess()).toBe(true);
    expect(calls).toEqual([{ accessLevel: "TRUSTED_CONTEXTS" }]);
  });
});
