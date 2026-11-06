/**
 * The bundled Mainnet shadow-account anonymizer (#666). New installs get it
 * from the defaults. An existing record that is exactly the bundled Mainnet
 * routing from before the default (same endpoints, pool, and fee token, no
 * anonymizer) gains it on read. Anything a user changed is kept as stored:
 * their own anonymizer, any custom endpoint, other networks, and an empty-map
 * opt-out. The anonymizer feeds every shadow-account identity, so the bundled
 * value is pinned here as well: changing it must fail a test, not just ship.
 */
import { describe, expect, test } from "bun:test";
import type { Json } from "@bramble/core/json";
import {
  DEFAULT_STRK20_NETWORKS,
  STRK20_MAINNET_POOL,
  STRK20_MAINNET_SHADOW_ACCOUNT_ANONYMIZER,
} from "@bramble/privacy/config";
import {
  createPreferencesStore,
  defaultWalletPreferences,
  PREFERENCES_STORE_KEY,
} from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { canonicalFelt, STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";

const PINNED_ANONYMIZER = "0x4f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7";
const USER_ANONYMIZER = `0x${"7".repeat(63)}`;

const bundledMainnet = () => {
  const config = DEFAULT_STRK20_NETWORKS.SN_MAIN;
  if (!config?.paymaster) throw new Error("missing bundled STRK20 Mainnet routing");
  return config;
};

// The bundled Mainnet routing as v0.10.8 and earlier persisted it, written out
// literally so a later change to the bundled defaults cannot move it.
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

const storedWith = async (strk20Networks: unknown) => {
  const store = createMemoryStore();
  await store.set(PREFERENCES_STORE_KEY, {
    ...defaultWalletPreferences(),
    strk20Networks,
  } as unknown as Json);
  return { preferences: createPreferencesStore({ store }), store };
};

describe("bundled Mainnet shadow-account anonymizer", () => {
  test("is pinned, canonical, and paired with the bundled pool", () => {
    expect(STRK20_MAINNET_SHADOW_ACCOUNT_ANONYMIZER).toBe(PINNED_ANONYMIZER);
    expect(canonicalFelt(STRK20_MAINNET_SHADOW_ACCOUNT_ANONYMIZER)).toBe(PINNED_ANONYMIZER);
    expect(bundledMainnet().shadowAccountAnonymizerAddress).toBe(PINNED_ANONYMIZER);
    expect(bundledMainnet().poolAddress).toBe(STRK20_MAINNET_POOL);
  });

  test("a new install reads it from the defaults", async () => {
    const read = await createPreferencesStore({ store: createMemoryStore() }).read();
    expect(read.strk20Networks?.SN_MAIN?.shadowAccountAnonymizerAddress).toBe(PINNED_ANONYMIZER);
  });

  test("the pre-default bundled snapshot gains it on read, other networks untouched", async () => {
    const sepolia = { ...preAnonymizerMainnet(), poolAddress: "0x5" };
    const { preferences } = await storedWith({
      SN_MAIN: preAnonymizerMainnet(),
      SN_SEPOLIA: sepolia,
    });
    const read = await preferences.read();
    expect(read.strk20Networks?.SN_MAIN).toEqual(bundledMainnet());
    expect(read.strk20Networks?.SN_SEPOLIA).toEqual(sepolia);
  });

  test("the next write persists it", async () => {
    const { preferences, store } = await storedWith({ SN_MAIN: preAnonymizerMainnet() });
    await preferences.setStrk20NetworkConfig({
      config: { ...preAnonymizerMainnet(), poolAddress: "0x5" },
      networkId: "SN_SEPOLIA",
    });
    expect(JSON.stringify(await store.get(PREFERENCES_STORE_KEY))).toContain(PINNED_ANONYMIZER);
  });

  test("a user-set anonymizer on bundled routing is kept", async () => {
    const config = { ...preAnonymizerMainnet(), shadowAccountAnonymizerAddress: USER_ANONYMIZER };
    const { preferences } = await storedWith({ SN_MAIN: config });
    expect((await preferences.read()).strk20Networks?.SN_MAIN).toEqual(config);
  });

  test("custom routing without an anonymizer is kept as stored", async () => {
    const base = preAnonymizerMainnet();
    if (!base.paymaster) throw new Error("missing bundled paymaster");
    for (const config of [
      { ...base, proverUrl: "https://prover.example/strk20" },
      { ...base, discoveryUrl: "https://discovery.example/strk20" },
      { ...base, ohttpEnabled: true },
      { ...base, ohttpRelayUrl: "https://relay.example/ohttp" },
      { ...base, paymaster: { ...base.paymaster, url: "https://paymaster.example/rpc" } },
      { ...base, paymaster: { ...base.paymaster, feeToken: "0x5" } },
      { ...base, poolAddress: "0x5" },
    ]) {
      const { preferences } = await storedWith({ SN_MAIN: config });
      expect((await preferences.read()).strk20Networks?.SN_MAIN).toEqual(config);
    }
  });

  test("an empty-map opt-out and a removed Mainnet entry stay off", async () => {
    const empty = await storedWith({});
    expect((await empty.preferences.read()).strk20Networks).toEqual({});
    const sepoliaOnly = { SN_SEPOLIA: { ...preAnonymizerMainnet(), poolAddress: "0x5" } };
    const noMainnet = await storedWith(sepoliaOnly);
    expect((await noMainnet.preferences.read()).strk20Networks).toEqual(sepoliaOnly);
  });
});
