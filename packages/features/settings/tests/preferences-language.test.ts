/**
 * The wallet language preference: unset means "follow the browser", and only
 * `"auto"` or a shipped locale is ever stored.
 */
import { describe, expect, test } from "bun:test";
import {
  createPreferencesStore,
  defaultWalletPreferences,
  PREFERENCES_STORE_KEY,
} from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";

describe("language preference", () => {
  test("leaves language unset (follow the browser) and accepts only shipped choices", async () => {
    const store = createMemoryStore();
    const preferences = createPreferencesStore({ store });

    expect((await preferences.read()).language).toBeUndefined();

    for (const language of ["zh-Hans", "en", "auto"] as const) {
      await preferences.setDisplay({ language });
      expect((await preferences.read()).language).toBe(language);
    }

    for (const language of ["zh", "zh-CN", "zh-Hant", "fr", ""]) {
      await expect(
        preferences.setDisplay({ language: language as unknown as "auto" }),
      ).rejects.toThrow("Invalid display preference");
    }
    expect((await preferences.read()).language).toBe("auto");
  });

  test("refuses a stored language the wallet does not ship", async () => {
    const store = createMemoryStore();
    await store.set(PREFERENCES_STORE_KEY, {
      ...JSON.parse(JSON.stringify(defaultWalletPreferences())),
      language: "klingon",
    });
    await expect(createPreferencesStore({ store }).read()).rejects.toThrow();
  });
});
