/**
 * Verifies persistent and session storage access lockdowns that keep direct
 * store access out of untrusted content-script contexts.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  hardenLocalAccess,
  hardenSessionAccess,
  hardenSyncAccess,
  requireTrustedStorageAccess,
} from "../../apps/extension/src/browser-storage";

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

describe("hardenSyncAccess", () => {
  test("restricts freshness markers to trusted extension contexts", async () => {
    const calls: unknown[] = [];
    globalWithChrome.chrome = {
      storage: {
        sync: {
          async setAccessLevel(options: unknown) {
            calls.push(options);
          },
        },
      },
    };
    expect(await hardenSyncAccess()).toBe(true);
    expect(calls).toEqual([{ accessLevel: "TRUSTED_CONTEXTS" }]);
  });
});

describe("requireTrustedStorageAccess", () => {
  test("requires local, session, and sync lockdowns", async () => {
    const calls: string[] = [];
    const restrictedArea = (area: string) => ({
      async setAccessLevel() {
        calls.push(area);
      },
    });
    globalWithChrome.chrome = {
      storage: {
        local: restrictedArea("local"),
        session: restrictedArea("session"),
        sync: restrictedArea("sync"),
      },
    };

    await expect(requireTrustedStorageAccess()).resolves.toBeUndefined();
    expect(calls.sort()).toEqual(["local", "session", "sync"]);
  });

  test("fails closed when either browser area cannot be restricted", async () => {
    globalWithChrome.chrome = {
      storage: {
        local: { async setAccessLevel() {} },
        session: {},
        sync: { async setAccessLevel() {} },
      },
    };

    await expect(requireTrustedStorageAccess()).rejects.toThrow(
      "trusted browser storage access is unavailable",
    );
  });

  test("propagates a browser lockdown failure", async () => {
    globalWithChrome.chrome = {
      storage: {
        local: {
          async setAccessLevel() {
            throw new Error("browser rejected lockdown");
          },
        },
        session: { async setAccessLevel() {} },
        sync: { async setAccessLevel() {} },
      },
    };

    await expect(requireTrustedStorageAccess()).rejects.toThrow("browser rejected lockdown");
  });
});
