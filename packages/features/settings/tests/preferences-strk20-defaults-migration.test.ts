/**
 * The bundled Mainnet rebase (#666) is a one-time migration, recorded in the
 * stored record as `strk20DefaultsVersion`. A record that predates it has its
 * exact bundled snapshot upgraded once; after that the stored routing is the
 * user's, so clearing the anonymizer sticks across reads, unrelated writes and
 * a backup restore. A fresh install starts migrated, with the default.
 */
import { describe, expect, test } from "bun:test";
import type { Json } from "@bramble/core/json";
import { DEFAULT_STRK20_NETWORKS } from "@bramble/privacy/config";
import {
  createPreferencesStore,
  defaultWalletPreferences,
  PREFERENCES_STORE_KEY,
} from "@bramble/settings/preferences";
import { exportablePreferences } from "@bramble/settings/preferences-backup";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";

const PINNED_ANONYMIZER = "0x4f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7";
const USER_ANONYMIZER = `0x${"7".repeat(63)}`;

// The bundled Mainnet routing as v0.10.8 and earlier persisted it, written out
// literally. It is also exactly what clearing today's default anonymizer leaves.
const preAnonymizerMainnet = () => ({
  discoveryUrl: "https://wallet.nodes.starknet.org/api/strk20/discovery",
  ohttpEnabled: false,
  paymaster: {
    feeToken: STRK_TOKEN_ADDRESS,
    url: "https://wallet.nodes.starknet.org/api/strk20/paymaster",
  },
  poolAddress: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  proverUrl: "https://wallet.nodes.starknet.org/api/strk20/prover",
});

const VERCEL = "https://mc-wallet-terminal.vercel.app/api/strk20";
const vercelMainnet = () => ({
  discoveryUrl: `${VERCEL}/discovery`,
  ohttpEnabled: true,
  paymaster: { feeToken: STRK_TOKEN_ADDRESS, url: `${VERCEL}/paymaster` },
  poolAddress: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  proverUrl: `${VERCEL}/prover`,
});

const storedWith = async (record: Record<string, unknown>) => {
  const store = createMemoryStore();
  await store.set(PREFERENCES_STORE_KEY, { ...defaultWalletPreferences(), ...record } as Json);
  return { preferences: createPreferencesStore({ store }), store };
};

const storedRecord = async (store: KeyValueStore) =>
  (await store.get(PREFERENCES_STORE_KEY)) as Record<string, unknown>;

const anonymizerOf = async (preferences: ReturnType<typeof createPreferencesStore>) =>
  (await preferences.read()).strk20Networks?.SN_MAIN?.shadowAccountAnonymizerAddress;

// Clears the Mainnet anonymizer, keeping every other bundled field, then proves
// the clear survives two reads and an unrelated preferences write.
const expectClearSticks = async (
  preferences: ReturnType<typeof createPreferencesStore>,
  store: KeyValueStore,
) => {
  await preferences.setStrk20NetworkConfig({
    config: preAnonymizerMainnet(),
    networkId: "SN_MAIN",
  });
  expect(await anonymizerOf(preferences)).toBeUndefined();
  expect(await anonymizerOf(preferences)).toBeUndefined();
  await preferences.setDisplay({ theme: "light" });
  expect(await anonymizerOf(preferences)).toBeUndefined();
  expect(JSON.stringify(await storedRecord(store))).not.toContain(PINNED_ANONYMIZER);
  expect((await storedRecord(store))["strk20DefaultsVersion"]).toBe(1);
};

describe("STRK20 bundled-defaults migration", () => {
  test("a first read upgrades the old snapshot once, and the next write records it", async () => {
    const { preferences, store } = await storedWith({
      strk20Networks: { SN_MAIN: preAnonymizerMainnet() },
    });
    const first = await preferences.read();
    expect(first.strk20DefaultsVersion).toBe(1);
    expect(first.strk20Networks?.SN_MAIN).toEqual(DEFAULT_STRK20_NETWORKS.SN_MAIN);
    expect((await storedRecord(store))["strk20DefaultsVersion"]).toBeUndefined();
    await preferences.setDisplay({ theme: "light" });
    const stored = await storedRecord(store);
    expect(stored["strk20DefaultsVersion"]).toBe(1);
    expect(JSON.stringify(stored)).toContain(PINNED_ANONYMIZER);
  });

  test("clearing the anonymizer after the upgrade stays cleared", async () => {
    const { preferences, store } = await storedWith({
      strk20Networks: { SN_MAIN: preAnonymizerMainnet() },
    });
    expect(await anonymizerOf(preferences)).toBe(PINNED_ANONYMIZER);
    await expectClearSticks(preferences, store);
  });

  test("clearing a user-set anonymizer stays cleared", async () => {
    const { preferences, store } = await storedWith({
      strk20Networks: {
        SN_MAIN: { ...preAnonymizerMainnet(), shadowAccountAnonymizerAddress: USER_ANONYMIZER },
      },
    });
    expect(await anonymizerOf(preferences)).toBe(USER_ANONYMIZER);
    await expectClearSticks(preferences, store);
  });

  test("a fresh install gets the default, and clearing it as the first write sticks", async () => {
    const store = createMemoryStore();
    const preferences = createPreferencesStore({ store });
    const read = await preferences.read();
    expect(read.strk20DefaultsVersion).toBe(1);
    expect(read.strk20Networks?.SN_MAIN?.shadowAccountAnonymizerAddress).toBe(PINNED_ANONYMIZER);
    await expectClearSticks(preferences, store);
  });

  test("a migrated record is never rebased again, Vercel-era snapshot included", async () => {
    for (const SN_MAIN of [preAnonymizerMainnet(), vercelMainnet()]) {
      const { preferences } = await storedWith({
        strk20DefaultsVersion: 1,
        strk20Networks: { SN_MAIN },
      });
      expect((await preferences.read()).strk20Networks?.SN_MAIN).toEqual(SN_MAIN);
    }
  });

  test("an unmigrated Vercel-era snapshot is still rebased, once", async () => {
    const { preferences, store } = await storedWith({
      strk20Networks: { SN_MAIN: vercelMainnet() },
    });
    expect((await preferences.read()).strk20Networks?.SN_MAIN).toEqual(
      DEFAULT_STRK20_NETWORKS.SN_MAIN,
    );
    await expectClearSticks(preferences, store);
  });

  test("the opt-out and custom routing are unchanged and marked migrated", async () => {
    const custom = { ...preAnonymizerMainnet(), proverUrl: "https://prover.example/strk20" };
    for (const strk20Networks of [{}, { SN_MAIN: custom }]) {
      const { preferences, store } = await storedWith({ strk20Networks });
      const read = await preferences.read();
      expect(read.strk20Networks).toEqual(strk20Networks);
      expect(read.strk20DefaultsVersion).toBe(1);
      await preferences.setDisplay({ theme: "light" });
      expect((await preferences.read()).strk20Networks).toEqual(strk20Networks);
      expect((await storedRecord(store))["strk20DefaultsVersion"]).toBe(1);
    }
  });

  test("a backup restore keeps the marker and the cleared anonymizer", async () => {
    const { preferences, store } = await storedWith({
      strk20Networks: { SN_MAIN: preAnonymizerMainnet() },
    });
    await preferences.setStrk20NetworkConfig({
      config: preAnonymizerMainnet(),
      networkId: "SN_MAIN",
    });
    const backup = exportablePreferences(await preferences.read());
    // The file stays restorable by builds that predate the marker.
    expect(Object.hasOwn(backup, "strk20DefaultsVersion")).toBe(false);
    await preferences.importPreferences(backup);
    // A file that does carry the marker (or an older one without it) never resets it.
    await preferences.importPreferences({ ...backup, strk20DefaultsVersion: 1 });
    expect(await anonymizerOf(preferences)).toBeUndefined();
    expect((await storedRecord(store))["strk20DefaultsVersion"]).toBe(1);
  });

  test("a restore over an unreadable record starts migrated", async () => {
    const store = createMemoryStore();
    await store.set(PREFERENCES_STORE_KEY, { corrupt: true });
    const preferences = createPreferencesStore({ store });
    await preferences.importPreferences(exportablePreferences(defaultWalletPreferences()));
    expect((await storedRecord(store))["strk20DefaultsVersion"]).toBe(1);
    await expectClearSticks(preferences, store);
  });

  test("the marker must be a positive integer", async () => {
    for (const strk20DefaultsVersion of [0, -1, 1.5, "1", null]) {
      const { preferences } = await storedWith({ strk20DefaultsVersion });
      await expect(preferences.read()).rejects.toThrow("Invalid stored preferences");
    }
    const { preferences } = await storedWith({
      strk20DefaultsVersion: 2,
      strk20Networks: { SN_MAIN: preAnonymizerMainnet() },
    });
    const read = await preferences.read();
    expect(read.strk20DefaultsVersion).toBe(2);
    expect(read.strk20Networks?.SN_MAIN).toEqual(preAnonymizerMainnet());
  });
});
