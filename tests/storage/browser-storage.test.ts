/**
 * Verifies persistent and session storage access lockdowns that keep direct
 * store access out of untrusted content-script contexts.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  hardenLocalAccess,
  hardenSessionAccess,
  hardenSyncAccess,
  lockdownIsEnforceable,
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

  // Every area, one at a time. The previous version of this test only ever
  // left `session` unrestrictable, so dropping `local` or `sync` from the fatal
  // condition changed nothing — and those two are the areas Firefox cannot lock
  // down at all, holding the vault blob and the rollback commit state.
  test.each(["local", "session", "sync"])(
    "fails closed when the %s area cannot be restricted",
    async (unrestrictable) => {
      const restrictable = { async setAccessLevel() {} };
      globalWithChrome.chrome = {
        storage: {
          local: unrestrictable === "local" ? {} : restrictable,
          session: unrestrictable === "session" ? {} : restrictable,
          sync: unrestrictable === "sync" ? {} : restrictable,
        },
      };

      await expect(requireTrustedStorageAccess()).rejects.toThrow(
        "trusted browser storage access is unavailable",
      );
    },
  );

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

// Whether a failed storage lockdown is fatal is a build-time decision, so the
// decision itself is tested here rather than the constant the bundler inlines.
// Firefox implements no setAccessLevel on any area, and refusing to start there
// would only mean refusing to run on Firefox; every other input keeps the
// Chromium rule, including a stamp this build has never heard of.
describe("storage lockdown enforcement", () => {
  test("relaxes only for the firefox target", () => {
    expect(lockdownIsEnforceable("firefox")).toBe(false);
  });

  test("accepts an unrestrictable browser when the target cannot enforce it", async () => {
    // Firefox: no area implements setAccessLevel, so all three lockdowns
    // report false and startup must still proceed.
    globalWithChrome.chrome = { storage: { local: {}, session: {}, sync: {} } };

    await expect(requireTrustedStorageAccess(false)).resolves.toBeUndefined();
  });

  test("still refuses the same browser when the target can enforce it", async () => {
    globalWithChrome.chrome = { storage: { local: {}, session: {}, sync: {} } };

    await expect(requireTrustedStorageAccess(true)).rejects.toThrow(
      "trusted browser storage access is unavailable",
    );
  });

  test("stays fatal for chromium, an unstamped bundle, and an unknown stamp", () => {
    expect(lockdownIsEnforceable("chrome")).toBe(true);
    expect(lockdownIsEnforceable(undefined)).toBe(true);
    expect(lockdownIsEnforceable("")).toBe(true);
    expect(lockdownIsEnforceable("Firefox")).toBe(true);
    expect(lockdownIsEnforceable("safari")).toBe(true);
  });
});
