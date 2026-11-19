/**
 * The Ready key notice dismissals: absent means none dismissed, each dismissal
 * names one canonical account id, repeats do not grow the list, the list is
 * bounded with the oldest dropping first, and a malformed id or stored list is
 * refused. The list never leaves the wallet in a backup.
 */
import { describe, expect, test } from "bun:test";
import {
  createPreferencesStore,
  defaultWalletPreferences,
  isWalletPreferences,
} from "@bramble/settings/preferences";
import { exportablePreferences } from "@bramble/settings/preferences-backup";
import { createMemoryStore } from "@bramble/store/kv";
import { MAX_READY_KEY_NOTICE_DISMISSALS } from "@bramble/wallet-model/preferences";

const id = (n: number): string => `SN_MAIN:0x${n.toString(16)}`;

describe("readyKeyNoticeDismissedIds preference", () => {
  test("is absent by default and records each dismissed account once", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });
    expect((await preferences.read()).readyKeyNoticeDismissedIds).toBeUndefined();
    await preferences.setDisplay({ readyKeyNoticeDismissed: id(1) });
    await preferences.setDisplay({ readyKeyNoticeDismissed: id(2) });
    await preferences.setDisplay({ readyKeyNoticeDismissed: id(1) });
    expect((await preferences.read()).readyKeyNoticeDismissedIds).toEqual([id(2), id(1)]);
    // Another display write leaves the list alone.
    await preferences.setDisplay({ theme: "light" });
    expect((await preferences.read()).readyKeyNoticeDismissedIds).toEqual([id(2), id(1)]);
  });

  test("keeps the newest dismissals past the bound", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });
    for (let n = 1; n <= MAX_READY_KEY_NOTICE_DISMISSALS + 2; n += 1) {
      await preferences.setDisplay({ readyKeyNoticeDismissed: id(n) });
    }
    const stored = (await preferences.read()).readyKeyNoticeDismissedIds ?? [];
    expect(stored).toHaveLength(MAX_READY_KEY_NOTICE_DISMISSALS);
    expect(stored[0]).toBe(id(3));
    expect(stored.at(-1)).toBe(id(MAX_READY_KEY_NOTICE_DISMISSALS + 2));
  });

  test("refuses a malformed account id and writes nothing", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });
    for (const bad of ["", "0x1", "SN_MAIN:not-hex", 7 as unknown as string]) {
      await expect(preferences.setDisplay({ readyKeyNoticeDismissed: bad })).rejects.toThrow(
        "Invalid display preference",
      );
    }
    expect((await preferences.read()).readyKeyNoticeDismissedIds).toBeUndefined();
  });

  test("validates the stored list: canonical ids, unique, bounded", () => {
    const defaults = defaultWalletPreferences();
    expect(isWalletPreferences(defaults)).toBe(true);
    expect(isWalletPreferences({ ...defaults, readyKeyNoticeDismissedIds: [id(1)] })).toBe(true);
    expect(isWalletPreferences({ ...defaults, readyKeyNoticeDismissedIds: [id(1), id(1)] })).toBe(
      false,
    );
    expect(isWalletPreferences({ ...defaults, readyKeyNoticeDismissedIds: ["0x1"] })).toBe(false);
    expect(isWalletPreferences({ ...defaults, readyKeyNoticeDismissedIds: id(1) })).toBe(false);
    const tooMany = Array.from({ length: MAX_READY_KEY_NOTICE_DISMISSALS + 1 }, (_, n) =>
      id(n + 1),
    );
    expect(isWalletPreferences({ ...defaults, readyKeyNoticeDismissedIds: tooMany })).toBe(false);
  });

  test("is never written to a preferences backup", () => {
    const stored = { ...defaultWalletPreferences(), readyKeyNoticeDismissedIds: [id(1)] };
    expect(exportablePreferences(stored).readyKeyNoticeDismissedIds).toBeUndefined();
  });
});
