/**
 * The Home VIP notice preference (issue 688): absent means shown, the user can
 * turn it off and back on, and only a boolean is ever stored.
 */
import { describe, expect, test } from "bun:test";
import {
  createPreferencesStore,
  defaultWalletPreferences,
  isWalletPreferences,
} from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";

describe("vipNotice preference", () => {
  test("is absent by default and round-trips an explicit choice", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });
    expect((await preferences.read()).vipNotice).toBeUndefined();
    await preferences.setDisplay({ vipNotice: false });
    expect((await preferences.read()).vipNotice).toBe(false);
    await preferences.setDisplay({ theme: "light" });
    expect((await preferences.read()).vipNotice).toBe(false);
    await preferences.setDisplay({ vipNotice: true });
    expect((await preferences.read()).vipNotice).toBe(true);
  });

  test("refuses a non-boolean write and a non-boolean stored value", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });
    await expect(
      preferences.setDisplay({ vipNotice: "off" as unknown as boolean }),
    ).rejects.toThrow("Invalid display preference");
    const defaults = defaultWalletPreferences();
    expect(isWalletPreferences({ ...defaults, vipNotice: false })).toBe(true);
    expect(isWalletPreferences({ ...defaults, vipNotice: "off" })).toBe(false);
  });

  test("still refuses a non-boolean analytics or diagnostics flag", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });
    await expect(
      preferences.setDisplay({ productAnalytics: 1 as unknown as boolean }),
    ).rejects.toThrow("Invalid display preference");
    await expect(
      preferences.setDisplay({ reliabilityDiagnostics: "yes" as unknown as boolean }),
    ).rejects.toThrow("Invalid display preference");
  });
});
