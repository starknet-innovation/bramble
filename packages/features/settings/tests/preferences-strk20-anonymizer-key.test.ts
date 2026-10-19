/**
 * The STRK20 anonymizer key rename (#443, PR 2). A preferences record written
 * before Wallet API 0.10.4 carries `subaccountAnonymizerAddress`; the config
 * guard rejects unknown keys, so without the normalizer that record would fail
 * the whole read with "Invalid stored preferences". The old value is dropped,
 * never carried into the new key (decision 3).
 */
import { describe, expect, test } from "bun:test";
import type { Json } from "@bramble/core/json";
import {
  createPreferencesStore,
  defaultWalletPreferences,
  PREFERENCES_STORE_KEY,
} from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";

const routing = {
  discoveryUrl: "https://discovery.example/strk20",
  poolAddress: "0x1",
  proverUrl: "https://prover.example/strk20",
};

const storedWith = async (strk20Networks: unknown) => {
  const store = createMemoryStore();
  await store.set(PREFERENCES_STORE_KEY, {
    ...defaultWalletPreferences(),
    strk20Networks,
  } as unknown as Json);
  return { preferences: createPreferencesStore({ store }), store };
};

describe("stored STRK20 anonymizer key", () => {
  test("an old record reads, with the retired anonymizer dropped rather than carried", async () => {
    const { preferences } = await storedWith({
      SN_MAIN: { ...routing, subaccountAnonymizerAddress: "0x2" },
      SN_SEPOLIA: { ...routing, poolAddress: "0x5" },
    });
    const read = await preferences.read();
    expect(read.strk20Networks?.SN_MAIN).toEqual(routing);
    expect(read.strk20Networks?.SN_MAIN?.shadowAccountAnonymizerAddress).toBeUndefined();
    expect(read.strk20Networks?.SN_SEPOLIA).toEqual({ ...routing, poolAddress: "0x5" });
  });

  test("the next write persists the old record without the retired key", async () => {
    const { preferences, store } = await storedWith({
      SN_MAIN: { ...routing, subaccountAnonymizerAddress: "0x2" },
    });
    await preferences.setStrk20NetworkConfig({
      config: { ...routing, poolAddress: "0x7" },
      networkId: "SN_SEPOLIA",
    });
    expect(JSON.stringify(await store.get(PREFERENCES_STORE_KEY))).not.toContain(
      "subaccountAnonymizerAddress",
    );
  });

  test("a current record keeps its shadow account anonymizer", async () => {
    const config = { ...routing, shadowAccountAnonymizerAddress: "0x2" };
    const { preferences } = await storedWith({ SN_MAIN: config });
    expect((await preferences.read()).strk20Networks?.SN_MAIN).toEqual(config);
  });

  test("a record holding both keys keeps only the current one", async () => {
    const { preferences } = await storedWith({
      SN_MAIN: {
        ...routing,
        shadowAccountAnonymizerAddress: "0x3",
        subaccountAnonymizerAddress: "0x2",
      },
    });
    expect((await preferences.read()).strk20Networks?.SN_MAIN).toEqual({
      ...routing,
      shadowAccountAnonymizerAddress: "0x3",
    });
  });

  test("an invalid record still fails closed", async () => {
    for (const strk20Networks of [
      { SN_MAIN: { ...routing, shadowAccountAnonymizerAddress: "0x0" } },
      { SN_MAIN: { ...routing, shadowAccountAnonymizerAddress: "not-a-felt" } },
      { SN_MAIN: { ...routing, proverUrl: "http://prover.example" } },
      { SN_MAIN: { ...routing, anonymizer: "0x2" } },
      { SN_MAIN: "not-a-config", subaccountAnonymizerAddress: "0x2" },
    ]) {
      const { preferences } = await storedWith(strk20Networks);
      await expect(preferences.read()).rejects.toThrow("Invalid stored preferences");
    }
  });
});
