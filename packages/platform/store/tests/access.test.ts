/**
 * Permission checks prove UI code cannot read privileged vault state directly.
 */
import { describe, expect, test } from "bun:test";
import { assertStoreAccess, canAccessStore } from "@mc-wallet/store/access";

describe("storage permissions", () => {
  test("allows popup preferences and denies popup vault access", () => {
    expect(canAccessStore("preferences", "popup")).toBe(true);
    expect(canAccessStore("vault", "popup")).toBe(false);
    expect(() => assertStoreAccess("vault", "popup")).toThrow("Storage access denied");
    expect(canAccessStore("vault", "content-script")).toBe(false);
    expect(canAccessStore("private-keys", "background")).toBe(false);
    expect(() => assertStoreAccess("private-keys", "background")).toThrow("Storage access denied");
    expect(canAccessStore("toString", "background")).toBe(false);
    expect(() => assertStoreAccess("toString", "background")).toThrow("Storage access denied");
  });
});
