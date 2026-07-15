/**
 * Plain preferences store checks prove non-secret wallet state is validated.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "../src/storage/kv";
import {
  createPreferencesStore,
  defaultWalletPreferences,
  PREFERENCES_STORE_KEY,
} from "../src/storage/preferences-store";

describe("createPreferencesStore", () => {
  test("creates default network, token, and address book preferences", async () => {
    const preferences = await createPreferencesStore({ store: createMemoryStore() }).read();

    expect(preferences.activeNetworkId).toBe("SN_MAIN");
    expect(preferences.addressBook).toEqual([]);
    expect(preferences.tokens.some((token) => token.networkId === "SN_DEVNET")).toBe(true);
  });

  test("persists active network and address book entries", async () => {
    const store = createMemoryStore();
    const preferences = createPreferencesStore({ store });

    await preferences.setActiveNetwork("SN_DEVNET");
    await preferences.saveAddress({
      address: "0x123",
      label: "Treasury",
      networkId: "SN_DEVNET",
    });

    await expect(preferences.read()).resolves.toMatchObject({
      activeNetworkId: "SN_DEVNET",
      addressBook: [{ address: "0x123", id: "SN_DEVNET:0x123", label: "Treasury" }],
    });
  });

  test("rejects malformed stored preferences", async () => {
    const store = createMemoryStore();
    await store.set(
      PREFERENCES_STORE_KEY,
      JSON.parse(JSON.stringify({ ...defaultWalletPreferences(), tokens: [] })),
    );

    await expect(createPreferencesStore({ store }).read()).resolves.toMatchObject({
      tokens: [],
    });

    await store.set(PREFERENCES_STORE_KEY, { activeNetworkId: "SN_SEPOLIA", schemaVersion: 1 });
    await expect(createPreferencesStore({ store }).read()).rejects.toThrow(
      "Invalid stored preferences",
    );
  });

  test("collapses legacy multi-group membership to a single folder on read", async () => {
    const store = createMemoryStore();
    // Seed data that predates the single-group model: SN_MAIN:0x1 filed in two
    // groups. The validator stays permissive so it loads, then read() self-heals.
    await store.set(
      PREFERENCES_STORE_KEY,
      JSON.parse(
        JSON.stringify({
          ...defaultWalletPreferences(),
          groups: [
            {
              accountIds: ["SN_MAIN:0x1", "SN_MAIN:0x2"],
              icon: "briefcase",
              id: "work",
              name: "Work",
            },
            { accountIds: ["SN_MAIN:0x1"], icon: "user", id: "personal", name: "Personal" },
          ],
        }),
      ),
    );

    const preferences = await createPreferencesStore({ store }).read();
    // The account is kept only in the first group (stable order); the singly
    // filed account is untouched.
    expect(preferences.groups?.[0]?.accountIds).toEqual(["SN_MAIN:0x1", "SN_MAIN:0x2"]);
    expect(preferences.groups?.[1]?.accountIds).toEqual([]);
  });

  test("stores, prefers, and clears custom RPC endpoints per network", async () => {
    const store = createMemoryStore();
    const preferences = createPreferencesStore({ store });

    await preferences.setRpcOverride({
      networkId: "SN_MAIN",
      rpcUrl: " https://my-node.example/rpc ",
    });
    await expect(preferences.read()).resolves.toMatchObject({
      rpcOverrides: { SN_MAIN: "https://my-node.example/rpc" },
    });

    await preferences.setRpcOverride({ networkId: "SN_MAIN", rpcUrl: "" });
    const cleared = await preferences.read();
    expect(cleared.rpcOverrides).toEqual({});
  });

  test("rejects unsafe custom RPC endpoints", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });

    await expect(
      preferences.setRpcOverride({ networkId: "SN_MAIN", rpcUrl: "http://rpc.example/rpc" }),
    ).rejects.toThrow("Invalid RPC endpoint");
    await expect(
      preferences.setRpcOverride({ networkId: "SN_MAIN", rpcUrl: "not a url" }),
    ).rejects.toThrow("Invalid RPC endpoint");
    await expect(
      preferences.setRpcOverride({ networkId: "SN_DEVNET", rpcUrl: "http://127.0.0.1:5050/rpc" }),
    ).resolves.toMatchObject({ rpcOverrides: { SN_DEVNET: "http://127.0.0.1:5050/rpc" } });
  });

  test("stores, prefers, and clears the STRK20 prover endpoint", async () => {
    const store = createMemoryStore();
    const preferences = createPreferencesStore({ store });

    await preferences.setStrk20ProverUrl({ url: " https://prover.example/strk20 " });
    await expect(preferences.read()).resolves.toMatchObject({
      strk20ProverUrl: "https://prover.example/strk20",
    });

    await preferences.setStrk20ProverUrl({ url: "" });
    const cleared = await preferences.read();
    expect(cleared.strk20ProverUrl).toBeUndefined();
  });

  test("rejects an unsafe STRK20 prover endpoint", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });

    await expect(preferences.setStrk20ProverUrl({ url: "http://prover.example" })).rejects.toThrow(
      "Invalid prover endpoint",
    );
    await expect(preferences.setStrk20ProverUrl({ url: "not a url" })).rejects.toThrow(
      "Invalid prover endpoint",
    );
    await expect(
      preferences.setStrk20ProverUrl({ url: "http://127.0.0.1:8080/strk20" }),
    ).resolves.toMatchObject({ strk20ProverUrl: "http://127.0.0.1:8080/strk20" });
  });

  test("accepts preferences stored before the STRK20 prover existed", async () => {
    const store = createMemoryStore();
    const legacy = { ...defaultWalletPreferences() };
    delete (legacy as Record<string, unknown>)["strk20ProverUrl"];
    await store.set(PREFERENCES_STORE_KEY, JSON.parse(JSON.stringify(legacy)));

    const preferences = await createPreferencesStore({ store }).read();
    expect(preferences.strk20ProverUrl).toBeUndefined();
  });

  test("accepts preferences stored before rpc overrides existed", async () => {
    const store = createMemoryStore();
    const legacy = { ...defaultWalletPreferences() };
    delete (legacy as Record<string, unknown>)["rpcOverrides"];
    await store.set(PREFERENCES_STORE_KEY, JSON.parse(JSON.stringify(legacy)));

    const preferences = await createPreferencesStore({ store }).read();
    expect(preferences.activeNetworkId).toBe("SN_MAIN");
    expect(preferences.rpcOverrides).toBeUndefined();
  });

  test("stores account labels, display settings, and removes contacts", async () => {
    const store = createMemoryStore();
    const preferences = createPreferencesStore({ store });
    const accountId = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

    await preferences.setAccountLabel({ accountId, label: "  Savings  " });
    await preferences.setDisplay({ displayCurrency: "eur", theme: "dark" });
    await preferences.saveAddress({ address: "0x123", label: "Ada", networkId: "SN_MAIN" });
    await preferences.removeAddress("SN_MAIN:0x123");

    const stored = await preferences.read();
    expect(stored.accountLabels?.[accountId]).toBe("Savings");
    expect(stored.displayCurrency).toBe("eur");
    expect(stored.theme).toBe("dark");
    expect(stored.addressBook).toEqual([]);

    await preferences.setAccountLabel({ accountId, label: "" });
    expect((await preferences.read()).accountLabels).toEqual({});
  });

  test("defaults theme to system and accepts every theme choice", async () => {
    const store = createMemoryStore();
    const preferences = createPreferencesStore({ store });

    expect((await preferences.read()).theme).toBe("system");

    await preferences.setDisplay({ theme: "light" });
    expect((await preferences.read()).theme).toBe("light");

    await preferences.setDisplay({ theme: "dark" });
    expect((await preferences.read()).theme).toBe("dark");

    await preferences.setDisplay({ theme: "system" });
    expect((await preferences.read()).theme).toBe("system");

    await expect(
      preferences.setDisplay({ theme: "midnight" as unknown as "system" }),
    ).rejects.toThrow("Invalid display preference");
  });

  test("hides and reveals tokens and stays compatible with legacy backups", async () => {
    const store = createMemoryStore();
    const preferences = createPreferencesStore({ store });
    const tokenId =
      "SN_MAIN:ETH:0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

    await preferences.setTokenHidden({ hidden: true, tokenId });
    expect((await preferences.read()).hiddenTokens).toEqual([tokenId]);
    await preferences.setTokenHidden({ hidden: true, tokenId });
    expect((await preferences.read()).hiddenTokens).toEqual([tokenId]);
    await preferences.setTokenHidden({ hidden: false, tokenId });
    expect((await preferences.read()).hiddenTokens).toEqual([]);

    const legacy = { ...defaultWalletPreferences() };
    delete (legacy as Record<string, unknown>)["hiddenTokens"];
    await store.set(PREFERENCES_STORE_KEY, JSON.parse(JSON.stringify(legacy)));
    expect((await createPreferencesStore({ store }).read()).hiddenTokens).toBeUndefined();
  });

  test("creates, edits, assigns, and removes account groups", async () => {
    const store = createMemoryStore();
    const preferences = createPreferencesStore({ store });
    const accountId = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

    await preferences.createGroup({ icon: "briefcase", name: "Trading" });
    await preferences.createGroup({ icon: "coins", name: "Trading" });
    const created = await preferences.read();
    expect(created.groups?.map((group) => group.id)).toEqual(["trading", "trading-2"]);

    await preferences.setAccountInGroup({ accountId, groupId: "trading", member: true });
    await preferences.renameGroup({ id: "trading", name: "Active Trading" });
    await preferences.setGroupIcon({ icon: "rocket", id: "trading" });
    const updated = await preferences.read();
    expect(updated.groups?.[0]).toMatchObject({
      accountIds: [accountId],
      icon: "rocket",
      id: "trading",
      name: "Active Trading",
    });

    await preferences.setAccountInGroup({ accountId, groupId: "trading", member: false });
    await preferences.removeGroup({ id: "trading-2" });
    const finalState = await preferences.read();
    expect(finalState.groups).toHaveLength(1);
    expect(finalState.groups?.[0]?.accountIds).toEqual([]);
  });

  test("rejects invalid group input and malformed stored groups", async () => {
    const store = createMemoryStore();
    const preferences = createPreferencesStore({ store });

    await expect(preferences.createGroup({ icon: "coins", name: "   " })).rejects.toThrow(
      "Invalid group name",
    );

    await store.set(
      PREFERENCES_STORE_KEY,
      JSON.parse(
        JSON.stringify({
          ...defaultWalletPreferences(),
          groups: [{ accountIds: [], icon: "not-an-icon", id: "x", name: "X" }],
        }),
      ),
    );
    await expect(createPreferencesStore({ store }).read()).rejects.toThrow(
      "Invalid stored preferences",
    );
  });

  test("accepts preferences stored before groups existed", async () => {
    const store = createMemoryStore();
    const legacy = { ...defaultWalletPreferences() };
    delete (legacy as Record<string, unknown>)["groups"];
    await store.set(PREFERENCES_STORE_KEY, JSON.parse(JSON.stringify(legacy)));

    const preferences = await createPreferencesStore({ store }).read();
    expect(preferences.groups).toBeUndefined();
  });

  test("imports only fully valid preference backups", async () => {
    const store = createMemoryStore();
    const preferences = createPreferencesStore({ store });

    const backup = { ...defaultWalletPreferences(), displayCurrency: "gbp" as const };
    await preferences.importPreferences(JSON.parse(JSON.stringify(backup)));
    expect((await preferences.read()).displayCurrency).toBe("gbp");

    await expect(preferences.importPreferences({ schemaVersion: 2 })).rejects.toThrow(
      "Invalid preferences backup",
    );
  });
});
