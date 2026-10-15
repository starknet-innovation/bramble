/**
 * Plain preferences store checks prove non-secret wallet state is validated.
 */
import { describe, expect, test } from "bun:test";
import {
  createPreferencesStore,
  defaultWalletPreferences,
  PREFERENCES_STORE_KEY,
} from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";

// The stored spelling of "0x123": every entry address is canonicalized by the
// shared id builder (MCW-V09-110), so the id is derived from this form.
const CANONICAL_123 = `0x${"0".repeat(61)}123`;

describe("createPreferencesStore", () => {
  test("creates default network, token, and address book preferences", async () => {
    const preferences = await createPreferencesStore({ store: createMemoryStore() }).read();

    expect(preferences.activeNetworkId).toBe("SN_MAIN");
    expect(preferences.approvalSurface).toBe("side-panel");
    expect(preferences.addressBook).toEqual([]);
    expect(preferences.productAnalytics).toBe(true);
    expect(preferences.tokens.some((token) => token.networkId === "SN_DEVNET")).toBe(true);
  });

  test("enables analytics for legacy preferences while preserving an explicit opt-out", async () => {
    const store = createMemoryStore();
    const legacy = { ...defaultWalletPreferences() };
    delete (legacy as Record<string, unknown>)["productAnalytics"];
    await store.set(PREFERENCES_STORE_KEY, JSON.parse(JSON.stringify(legacy)));

    const preferences = createPreferencesStore({ store });
    expect((await preferences.read()).productAnalytics).toBe(true);
    await preferences.setDisplay({ productAnalytics: false });
    expect((await preferences.read()).productAnalytics).toBe(false);
  });

  test("persists active network and address book entries", async () => {
    const store = createMemoryStore();
    const preferences = createPreferencesStore({ store });

    await preferences.setActiveNetwork("SN_DEVNET");
    await preferences.saveAddress({
      address: "0x123",
      label: "Treasury",
      networkId: "SN_DEVNET",
      publicKeyX: "0x000abc",
    });

    // Stored in the one canonical spelling every entry id is derived from
    // (MCW-V09-110), so a contact re-saved in another spelling of the same
    // address replaces it rather than joining it.
    await expect(preferences.read()).resolves.toMatchObject({
      activeNetworkId: "SN_DEVNET",
      addressBook: [
        {
          address: CANONICAL_123,
          id: `SN_DEVNET:${CANONICAL_123}`,
          label: "Treasury",
          publicKeyX: "0xabc",
        },
      ],
    });

    await preferences.saveAddress({ address: "0x123", label: "Vault", networkId: "SN_DEVNET" });
    expect((await preferences.read()).addressBook[0]?.publicKeyX).toBe("0xabc");
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
    // filed account is untouched. The read also seeds the two default folders,
    // so the user's own groups sit between them.
    const byId = (id: string) => preferences.groups?.find((group) => group.id === id);
    expect(byId("work")?.accountIds).toEqual(["SN_MAIN:0x1", "SN_MAIN:0x2"]);
    expect(byId("personal")?.accountIds).toEqual([]);
    expect(preferences.groups?.map((group) => group.id)).toEqual([
      "my-accounts",
      "work",
      "personal",
      "archived-accounts",
    ]);
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

  test("stores and clears a secure custom Nostr relay", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });

    await preferences.setNostrRelayUrl({ relayUrl: " wss://relay.team.example/multisig " });
    expect((await preferences.read()).nostrRelayUrl).toBe("wss://relay.team.example/multisig");

    await expect(preferences.setNostrRelayUrl({ relayUrl: "ws://relay.example" })).rejects.toThrow(
      "Invalid Nostr relay endpoint",
    );
    await preferences.setNostrRelayUrl({ relayUrl: "" });
    expect((await preferences.read()).nostrRelayUrl).toBeUndefined();
  });

  test("stores and clears complete per-network STRK20 service routing", async () => {
    const store = createMemoryStore();
    const preferences = createPreferencesStore({ store });
    const config = {
      discoveryUrl: "https://discovery.example/strk20",
      paymaster: {
        feeToken: "0x3",
        url: "https://paymaster.example/strk20",
      },
      poolAddress: "0x1",
      proverUrl: "https://prover.example/strk20",
      shadowAccountAnonymizerAddress: "0x2",
    };
    await preferences.setStrk20NetworkConfig({ config, networkId: "SN_MAIN" });
    await expect(preferences.read()).resolves.toMatchObject({
      strk20Networks: { SN_MAIN: config },
    });

    await preferences.setStrk20NetworkConfig({ config: null, networkId: "SN_MAIN" });
    const cleared = await preferences.read();
    expect(cleared.strk20Networks?.SN_MAIN).toBeUndefined();
  });

  test("rejects incomplete or unsafe STRK20 service routing", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });
    await expect(
      preferences.setStrk20NetworkConfig({
        config: {
          discoveryUrl: "https://discovery.example",
          poolAddress: "0x1",
          proverUrl: "http://prover.example",
          shadowAccountAnonymizerAddress: "0x2",
        },
        networkId: "SN_MAIN",
      }),
    ).rejects.toThrow("Invalid STRK20 network configuration");
  });

  test("accepts preferences stored before the STRK20 prover existed", async () => {
    const store = createMemoryStore();
    const legacy = { ...defaultWalletPreferences() };
    delete (legacy as Record<string, unknown>)["strk20ProverUrl"];
    await store.set(PREFERENCES_STORE_KEY, JSON.parse(JSON.stringify(legacy)));

    const preferences = await createPreferencesStore({ store }).read();
    expect(preferences.strk20ProverUrl).toBeUndefined();
  });

  test("adds the bundled privacy gateway to legacy preferences exactly once", async () => {
    const store = createMemoryStore();
    const legacy = { ...defaultWalletPreferences() };
    delete (legacy as Record<string, unknown>)["strk20Networks"];
    await store.set(PREFERENCES_STORE_KEY, JSON.parse(JSON.stringify(legacy)));

    const preferences = createPreferencesStore({ store });
    const bundled = (await preferences.read()).strk20Networks?.SN_MAIN;
    expect(bundled?.ohttpEnabled).toBe(false);
    expect(bundled?.poolAddress).toMatch(/^0x[0-9a-f]+$/);
    await preferences.setStrk20NetworkConfig({ config: null, networkId: "SN_MAIN" });
    expect((await preferences.read()).strk20Networks?.SN_MAIN).toBeUndefined();
  });

  test("rebases only the retired bundled STRK20 Mainnet routing", async () => {
    const store = createMemoryStore();
    const defaults = defaultWalletPreferences();
    const currentMainnet = defaults.strk20Networks?.SN_MAIN;
    if (!currentMainnet?.paymaster) {
      throw new Error("missing bundled STRK20 Mainnet routing");
    }
    const retiredMainnet = {
      ...currentMainnet,
      discoveryUrl: "https://mc-wallet-terminal.vercel.app/api/strk20/discovery",
      ohttpEnabled: true,
      paymaster: {
        ...currentMainnet.paymaster,
        url: "https://mc-wallet-terminal.vercel.app/api/strk20/paymaster",
      },
      proverUrl: "https://mc-wallet-terminal.vercel.app/api/strk20/prover",
    };

    await store.set(
      PREFERENCES_STORE_KEY,
      JSON.parse(JSON.stringify({ ...defaults, strk20Networks: { SN_MAIN: retiredMainnet } })),
    );
    await expect(createPreferencesStore({ store }).read()).resolves.toMatchObject({
      strk20Networks: defaults.strk20Networks,
    });

    const customMainnet = { ...retiredMainnet, proverUrl: "https://prover.example/strk20" };
    await store.set(
      PREFERENCES_STORE_KEY,
      JSON.parse(JSON.stringify({ ...defaults, strk20Networks: { SN_MAIN: customMainnet } })),
    );
    await expect(createPreferencesStore({ store }).read()).resolves.toMatchObject({
      strk20Networks: { SN_MAIN: customMainnet },
    });

    await store.set(
      PREFERENCES_STORE_KEY,
      JSON.parse(JSON.stringify({ ...defaults, strk20Networks: {} })),
    );
    await expect(createPreferencesStore({ store }).read()).resolves.toMatchObject({
      strk20Networks: {},
    });
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
    await preferences.setDisplay({
      approvalSurface: "popup",
      displayCurrency: "eur",
      productAnalytics: true,
      reliabilityDiagnostics: true,
      theme: "dark",
    });
    await preferences.saveAddress({ address: "0x123", label: "Ada", networkId: "SN_MAIN" });
    await preferences.removeAddress(`SN_MAIN:${CANONICAL_123}`);

    const stored = await preferences.read();
    expect(stored.accountLabels?.[accountId]).toBe("Savings");
    expect(stored.approvalSurface).toBe("popup");
    expect(stored.displayCurrency).toBe("eur");
    expect(stored.productAnalytics).toBe(true);
    expect(stored.reliabilityDiagnostics).toBe(true);
    expect(stored.theme).toBe("dark");
    expect(stored.addressBook).toEqual([]);

    await preferences.setAccountLabel({ accountId, label: "" });
    expect((await preferences.read()).accountLabels).toEqual({});
  });

  test("defaults theme to dark and accepts every theme choice", async () => {
    const store = createMemoryStore();
    const preferences = createPreferencesStore({ store });

    expect((await preferences.read()).theme).toBe("dark");

    await preferences.setDisplay({ theme: "light" });
    expect((await preferences.read()).theme).toBe("light");

    await preferences.setDisplay({ theme: "dark" });
    expect((await preferences.read()).theme).toBe("dark");

    // "system" is a legacy value from the removed follow-the-browser theme: no
    // UI writes it anymore, but the store keeps accepting it so restoring an
    // old backup (or an un-migrated stored value) never fails validation. The
    // side panel resolves it to the default dark skin (see ui/theme.ts).
    await preferences.setDisplay({ theme: "system" });
    expect((await preferences.read()).theme).toBe("system");

    await expect(
      preferences.setDisplay({ theme: "midnight" as unknown as "system" }),
    ).rejects.toThrow("Invalid display preference");
  });

  test("accepts legacy preferences and validates approval surfaces", async () => {
    const store = createMemoryStore();
    const legacy = { ...defaultWalletPreferences() };
    delete (legacy as Record<string, unknown>)["approvalSurface"];
    await store.set(PREFERENCES_STORE_KEY, JSON.parse(JSON.stringify(legacy)));

    const preferences = createPreferencesStore({ store });
    expect((await preferences.read()).approvalSurface).toBeUndefined();
    await preferences.setDisplay({ approvalSurface: "popup" });
    expect((await preferences.read()).approvalSurface).toBe("popup");
    await expect(
      preferences.setDisplay({
        approvalSurface: "window" as unknown as "side-panel",
      }),
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

  test("hides and reveals accounts and stays compatible with legacy backups", async () => {
    const store = createMemoryStore();
    const preferences = createPreferencesStore({ store });
    const accountId = "SN_MAIN:0x1";

    await preferences.setAccountHidden({ accountId, hidden: true });
    expect((await preferences.read()).hiddenAccountIds).toEqual([accountId]);
    await preferences.setAccountHidden({ accountId, hidden: true });
    expect((await preferences.read()).hiddenAccountIds).toEqual([accountId]);
    await preferences.setAccountHidden({ accountId, hidden: false });
    expect((await preferences.read()).hiddenAccountIds).toEqual([]);

    const legacy = { ...defaultWalletPreferences() };
    delete (legacy as Record<string, unknown>)["hiddenAccountIds"];
    await store.set(PREFERENCES_STORE_KEY, JSON.parse(JSON.stringify(legacy)));
    expect((await createPreferencesStore({ store }).read()).hiddenAccountIds).toBeUndefined();
  });

  test("creates, edits, assigns, and removes account groups", async () => {
    const store = createMemoryStore();
    const preferences = createPreferencesStore({ store });
    const accountId = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

    await preferences.createGroup({ icon: "briefcase", name: "Trading" });
    await preferences.createGroup({ icon: "coins", name: "Trading" });
    const created = await preferences.read();
    // Between the two default folders, which every read guarantees.
    expect(created.groups?.map((group) => group.id)).toEqual([
      "my-accounts",
      "trading",
      "trading-2",
      "archived-accounts",
    ]);

    await preferences.setAccountInGroup({ accountId, groupId: "trading", member: true });
    await preferences.renameGroup({ id: "trading", name: "Active Trading" });
    await preferences.setGroupIcon({ icon: "rocket", id: "trading" });
    const updated = await preferences.read();
    expect(updated.groups?.find((group) => group.id === "trading")).toMatchObject({
      accountIds: [accountId],
      icon: "rocket",
      id: "trading",
      name: "Active Trading",
    });

    await preferences.setAccountInGroup({ accountId, groupId: "trading", member: false });
    await preferences.removeGroup({ id: "trading-2" });
    const finalState = await preferences.read();
    // "trading-2" is gone; the survivor sits between the two defaults.
    expect(finalState.groups?.map((group) => group.id)).toEqual([
      "my-accounts",
      "trading",
      "archived-accounts",
    ]);
    expect(finalState.groups?.find((group) => group.id === "trading")?.accountIds).toEqual([]);
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
