/**
 * Preference message dispatch input-validation branches: every handler in
 * handlePreferenceOps rejects a malformed message with its own "invalid …
 * request" response before touching the store. Driven with a real store so a
 * regression that lets a bad payload through would reach it and fail here.
 */
import { describe, expect, test } from "bun:test";
import { handlePreferenceOps } from "../../src/background/preference-ops";
import { createMemoryStore } from "../../src/storage/kv";
import { createPreferencesStore } from "../../src/storage/preferences-store";

const store = () => createPreferencesStore({ store: createMemoryStore() });

// Each case carries a message whose payload fails the handler's readXInput
// guard (an extra `debug` key, a wrong-typed field, or a missing required one),
// so the null-guard branch returns the handler's specific error string.
const cases: ReadonlyArray<{ error: string; message: Record<string, unknown>; type: string }> = [
  {
    error: "invalid preferences request",
    message: { debug: true, type: "wallet.preferences" },
    type: "wallet.preferences",
  },
  {
    error: "invalid address book request",
    message: { type: "wallet.saveAddress" },
    type: "wallet.saveAddress",
  },
  {
    error: "invalid address book request",
    message: { type: "wallet.removeAddress" },
    type: "wallet.removeAddress",
  },
  { error: "invalid nft request", message: { type: "wallet.removeNft" }, type: "wallet.removeNft" },
  {
    error: "invalid nft request",
    message: { type: "wallet.setNftSpam" },
    type: "wallet.setNftSpam",
  },
  {
    error: "invalid account label request",
    message: { type: "wallet.setAccountLabel" },
    type: "wallet.setAccountLabel",
  },
  {
    error: "invalid group request",
    message: { type: "wallet.createGroup" },
    type: "wallet.createGroup",
  },
  {
    error: "invalid group request",
    message: { type: "wallet.renameGroup" },
    type: "wallet.renameGroup",
  },
  {
    error: "invalid group request",
    message: { type: "wallet.setGroupIcon" },
    type: "wallet.setGroupIcon",
  },
  {
    error: "invalid group request",
    message: { type: "wallet.removeGroup" },
    type: "wallet.removeGroup",
  },
  {
    error: "invalid group request",
    message: { type: "wallet.setAccountInGroup" },
    type: "wallet.setAccountInGroup",
  },
  {
    error: "invalid display request",
    message: { theme: "neon", type: "wallet.setDisplay" },
    type: "wallet.setDisplay",
  },
  {
    error: "invalid rpc override request",
    message: { type: "wallet.setRpcOverride" },
    type: "wallet.setRpcOverride",
  },
  {
    error: "invalid indexer endpoint request",
    message: { type: "wallet.setNftIndexerUrl" },
    type: "wallet.setNftIndexerUrl",
  },
  {
    error: "invalid strk20 service configuration",
    message: { type: "wallet.setStrk20NetworkConfig" },
    type: "wallet.setStrk20NetworkConfig",
  },
  {
    error: "invalid preferences backup",
    message: { type: "wallet.importPreferences" },
    type: "wallet.importPreferences",
  },
];

describe("handlePreferenceOps input validation", () => {
  for (const { error, message, type } of cases) {
    test(`rejects a malformed ${type} message`, async () => {
      await expect(handlePreferenceOps(store(), type, message)).resolves.toEqual({ error });
    });
  }

  test("returns null for an unrelated message type", async () => {
    await expect(
      handlePreferenceOps(store(), "wallet.status", { type: "wallet.status" }),
    ).resolves.toBeNull();
  });

  test("serves a well-formed preferences read so the guard is not over-eager", async () => {
    const response = await handlePreferenceOps(store(), "wallet.preferences", {
      type: "wallet.preferences",
    });
    expect(response).toMatchObject({ ok: true });
    expect(response).toHaveProperty("preferences");
  });

  test("applies a well-formed rpc override and returns the updated preferences", async () => {
    const preferencesStore = store();
    const response = await handlePreferenceOps(preferencesStore, "wallet.setRpcOverride", {
      networkId: "SN_MAIN",
      rpcUrl: "https://rpc.example.com",
      type: "wallet.setRpcOverride",
    });
    expect(response).toMatchObject({ ok: true });
    expect((await preferencesStore.read()).rpcOverrides?.SN_MAIN).toBe("https://rpc.example.com");
  });

  test("applies and clears complete STRK20 network routing", async () => {
    const preferencesStore = store();
    const config = {
      discoveryUrl: "https://privacy.example/discovery",
      paymaster: { feeToken: "0x5", url: "https://privacy.example/paymaster" },
      poolAddress: "0x2",
      proverUrl: "https://privacy.example/prover",
      subaccountAnonymizerAddress: "0x3",
    };
    await expect(
      handlePreferenceOps(preferencesStore, "wallet.setStrk20NetworkConfig", {
        config,
        networkId: "SN_MAIN",
        type: "wallet.setStrk20NetworkConfig",
      }),
    ).resolves.toMatchObject({ ok: true });
    expect((await preferencesStore.read()).strk20Networks?.SN_MAIN).toEqual(config);

    await handlePreferenceOps(preferencesStore, "wallet.setStrk20NetworkConfig", {
      config: null,
      networkId: "SN_MAIN",
      type: "wallet.setStrk20NetworkConfig",
    });
    expect((await preferencesStore.read()).strk20Networks?.SN_MAIN).toBeUndefined();
  });

  test("imports a well-formed preferences backup and returns the merged state", async () => {
    const preferencesStore = store();
    // A valid backup: the store's own current preferences round-trip through the
    // import validator, exercising the success return rather than the guard.
    const current = await preferencesStore.read();
    const response = await handlePreferenceOps(preferencesStore, "wallet.importPreferences", {
      preferences: current,
      type: "wallet.importPreferences",
    });
    expect(response).toMatchObject({ ok: true });
    expect(response).toHaveProperty("preferences");
  });
});
