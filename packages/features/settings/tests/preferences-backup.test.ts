/**
 * The preferences backup carries only what a restore reapplies (Sherlock 213).
 *
 * A restore keeps every trust-bearing field at its stored value, so writing the
 * address book, custom endpoints or hidden accounts to the file exported the
 * contact graph while promising a restore that never brought it back.
 */
import { describe, expect, test } from "bun:test";
import {
  createPreferencesStore,
  defaultWalletPreferences,
  isWalletPreferences,
} from "@bramble/settings/preferences";
import { exportablePreferences } from "@bramble/settings/preferences-backup";
import { createMemoryStore } from "@bramble/store/kv";

const accountId = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

const populated = async () => {
  const preferences = createPreferencesStore({ store: createMemoryStore() });
  await preferences.saveAddress({ address: "0x123", label: "Ada", networkId: "SN_MAIN" });
  await preferences.setAccountLabel({ accountId, label: "Savings" });
  await preferences.setDisplay({ displayCurrency: "eur", theme: "light" });
  return preferences;
};

describe("exportablePreferences", () => {
  test("leaves the address book and other trust-bearing fields out", async () => {
    const stored = await (await populated()).read();
    expect(stored.addressBook).toHaveLength(1);

    const backup = exportablePreferences(stored);

    expect(backup.addressBook).toEqual([]);
    expect(backup.hiddenAccountIds).toEqual([]);
    expect(backup.customNetworks).toEqual([]);
    expect(backup.rpcOverrides).toEqual({});
    expect(JSON.stringify(backup)).not.toContain("Ada");
  });

  test("keeps the fields a restore reapplies", async () => {
    const backup = exportablePreferences(await (await populated()).read());

    expect(backup.accountLabels).toEqual({ [accountId]: "Savings" });
    expect(backup.displayCurrency).toBe("eur");
    expect(backup.theme).toBe("light");
    expect(backup.activeNetworkId).toBe("SN_MAIN");
  });

  test("is a valid backup that restores the same organisational settings", async () => {
    const backup = exportablePreferences(await (await populated()).read());
    expect(isWalletPreferences(backup)).toBe(true);

    const fresh = createPreferencesStore({ store: createMemoryStore() });
    await fresh.importPreferences(JSON.parse(JSON.stringify(backup)));
    const restored = await fresh.read();

    expect(restored.accountLabels).toEqual({ [accountId]: "Savings" });
    expect(restored.theme).toBe("light");
    expect(restored.addressBook).toEqual(defaultWalletPreferences().addressBook);
  });
});
