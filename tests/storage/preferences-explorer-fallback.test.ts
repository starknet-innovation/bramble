/**
 * MCW-V09-129: the stored side of the explorer-fallback opt-in — the derived
 * default, the explicit per-network choice, the stored-record validator, and
 * the fact that a preferences backup can neither arm nor disarm the lane.
 *
 * The default is deliberately derived rather than written at first run, so a
 * user who configures an RPC override later inherits the safer answer without
 * a migration and without the wallet claiming a decision they never made.
 */
import { describe, expect, test } from "bun:test";
import {
  createPreferencesStore,
  defaultWalletPreferences,
  isWalletPreferences,
  PREFERENCES_STORE_KEY,
} from "@mc-wallet/settings/preferences";
import { createMemoryStore } from "@mc-wallet/store/kv";
import { explorerFallbackAllowed, isExplorerFallback } from "@mc-wallet/wallet-model/preferences";

const MY_NODE = "https://my-node.example/rpc";
const MY_EXPLORER = "https://explorer.example/v1";
const store = () => createPreferencesStore({ store: createMemoryStore() });

describe("explorerFallbackAllowed", () => {
  test("defaults on for a user on the built-in endpoints", () => {
    expect(explorerFallbackAllowed({}, "SN_MAIN")).toBe(true);
    expect(explorerFallbackAllowed({ rpcOverrides: {} }, "SN_MAIN")).toBe(true);
  });

  test("defaults off once that network has an rpcOverride", () => {
    expect(explorerFallbackAllowed({ rpcOverrides: { SN_MAIN: MY_NODE } }, "SN_MAIN")).toBe(false);
  });

  test("derives the default per network, not per wallet", () => {
    const preferences = { rpcOverrides: { SN_SEPOLIA: MY_NODE } };

    expect(explorerFallbackAllowed(preferences, "SN_SEPOLIA")).toBe(false);
    expect(explorerFallbackAllowed(preferences, "SN_MAIN")).toBe(true);
  });

  test("an explicit choice wins over the derived default in both directions", () => {
    expect(
      explorerFallbackAllowed(
        { explorerFallback: { SN_MAIN: true }, rpcOverrides: { SN_MAIN: MY_NODE } },
        "SN_MAIN",
      ),
    ).toBe(true);
    expect(explorerFallbackAllowed({ explorerFallback: { SN_MAIN: false } }, "SN_MAIN")).toBe(
      false,
    );
  });
});

describe("isExplorerFallback", () => {
  test("accepts an empty map and known-network booleans", () => {
    expect(isExplorerFallback({})).toBe(true);
    expect(isExplorerFallback({ SN_MAIN: false, SN_SEPOLIA: true })).toBe(true);
  });

  test("rejects unknown networks and any non-boolean value", () => {
    expect(isExplorerFallback({ SN_FAKE: true })).toBe(false);
    // A truthy non-boolean must never be read as consent to disclose.
    expect(isExplorerFallback({ SN_MAIN: "yes" })).toBe(false);
    expect(isExplorerFallback({ SN_MAIN: 1 })).toBe(false);
    expect(isExplorerFallback(null)).toBe(false);
  });
});

describe("stored explorer-fallback preferences", () => {
  test("records the API and disclosure choice atomically", async () => {
    const preferences = store();

    await expect(
      preferences.setExplorerFallback({
        apiUrl: MY_EXPLORER,
        enabled: false,
        networkId: "SN_MAIN",
      }),
    ).resolves.toMatchObject({
      explorerApiUrls: { SN_MAIN: MY_EXPLORER },
      explorerFallback: { SN_MAIN: false },
    });
    await expect(
      preferences.setExplorerFallback({ enabled: true, networkId: "SN_MAIN" }),
    ).resolves.toMatchObject({
      explorerApiUrls: { SN_MAIN: MY_EXPLORER },
      explorerFallback: { SN_MAIN: true },
    });

    expect((await preferences.read()).explorerFallback).toEqual({ SN_MAIN: true });
  });

  test("rejects an insecure explorer API without changing either setting", async () => {
    const preferences = store();
    await preferences.setExplorerFallback({ enabled: false, networkId: "SN_MAIN" });

    await expect(
      preferences.setExplorerFallback({
        apiUrl: "http://explorer.example/v1",
        enabled: true,
        networkId: "SN_MAIN",
      }),
    ).rejects.toThrow("Invalid explorer API endpoint");
    expect(await preferences.read()).toMatchObject({
      explorerApiUrls: {},
      explorerFallback: { SN_MAIN: false },
    });
  });

  test("leaves every other network undecided", async () => {
    const preferences = store();

    await preferences.setExplorerFallback({ enabled: false, networkId: "SN_SEPOLIA" });

    const stored = await preferences.read();
    expect(stored.explorerFallback?.SN_MAIN).toBeUndefined();
    expect(explorerFallbackAllowed(stored, "SN_MAIN")).toBe(true);
    expect(explorerFallbackAllowed(stored, "SN_SEPOLIA")).toBe(false);
  });

  test("setting an rpcOverride does not overwrite an explicit opt-in", async () => {
    const preferences = store();

    await preferences.setExplorerFallback({ enabled: true, networkId: "SN_MAIN" });
    const next = await preferences.setRpcOverride({ networkId: "SN_MAIN", rpcUrl: MY_NODE });

    expect(next.explorerFallback).toEqual({ SN_MAIN: true });
    expect(explorerFallbackAllowed(next, "SN_MAIN")).toBe(true);
  });

  test("rejects an unknown network rather than storing it", async () => {
    await expect(
      store().setExplorerFallback({
        enabled: true,
        networkId: "SN_FAKE" as unknown as "SN_MAIN",
      }),
    ).rejects.toThrow("Invalid Starknet network");
  });

  test("reads a record written before the field existed, no migration needed", async () => {
    const kv = createMemoryStore();
    const legacy = { ...defaultWalletPreferences() };
    delete (legacy as Record<string, unknown>)["explorerFallback"];
    await kv.set(PREFERENCES_STORE_KEY, JSON.parse(JSON.stringify(legacy)));

    const preferences = await createPreferencesStore({ store: kv }).read();

    expect(preferences.schemaVersion).toBe(1);
    expect(preferences.explorerFallback).toBeUndefined();
    expect(explorerFallbackAllowed(preferences, "SN_MAIN")).toBe(true);
  });

  test("refuses a stored record whose explorerFallback is not a boolean map", () => {
    expect(
      isWalletPreferences({ ...defaultWalletPreferences(), explorerFallback: { SN_MAIN: "yes" } }),
    ).toBe(false);
    expect(
      isWalletPreferences({ ...defaultWalletPreferences(), explorerFallback: { SN_MAIN: true } }),
    ).toBe(true);
    expect(
      isWalletPreferences({
        ...defaultWalletPreferences(),
        explorerApiUrls: { SN_MAIN: "http://explorer.example" },
      }),
    ).toBe(false);
  });

  test("a backup file can neither arm nor disarm the lane", async () => {
    const preferences = store();
    await preferences.setExplorerFallback({ enabled: false, networkId: "SN_MAIN" });

    const restored = await preferences.importPreferences({
      ...defaultWalletPreferences(),
      explorerApiUrls: { SN_MAIN: MY_EXPLORER },
      explorerFallback: { SN_MAIN: true },
    });

    expect(restored.explorerApiUrls).toEqual({});
    expect(restored.explorerFallback).toEqual({ SN_MAIN: false });
  });
});
