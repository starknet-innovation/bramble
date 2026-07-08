/**
 * Verifies the session storage access-level lockdown that keeps the mirrored
 * unlock secret out of untrusted content scripts and web pages.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { hardenSessionAccess } from "../src/storage/browser-storage";

type MutableGlobal = { chrome?: unknown };
const globalWithChrome = globalThis as unknown as MutableGlobal;

afterEach(() => {
  globalWithChrome.chrome = undefined;
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
