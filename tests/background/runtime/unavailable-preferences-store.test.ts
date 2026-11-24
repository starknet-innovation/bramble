/**
 * The preferences store used where no browser storage is wired: reads return
 * defaults, switching networks echoes the choice without persisting it, and
 * every write refuses instead of silently dropping the change.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { unavailablePreferencesStore } from "../../../apps/extension/src/background/runtime/unavailable-preferences-store";

const READS_OR_ECHOES = new Set(["read", "setActiveNetwork"]);

describe("unavailable preferences store", () => {
  test("reads return the default preferences", async () => {
    expect(await unavailablePreferencesStore.read()).toEqual(defaultWalletPreferences());
  });

  test("switching network returns defaults on the chosen network", async () => {
    const preferences = await unavailablePreferencesStore.setActiveNetwork("SN_SEPOLIA");
    expect(preferences).toEqual({ ...defaultWalletPreferences(), activeNetworkId: "SN_SEPOLIA" });
  });

  test("every write refuses", async () => {
    const writes = Object.entries(unavailablePreferencesStore).filter(
      ([name]) => !READS_OR_ECHOES.has(name),
    );
    expect(writes.length).toBeGreaterThan(20);
    for (const [name, write] of writes) {
      const call = (write as (...args: unknown[]) => Promise<unknown>)();
      await expect(call, name).rejects.toThrow("preferences unavailable");
    }
  });
});
