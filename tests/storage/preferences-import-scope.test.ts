/**
 * MCW-V09-107: a preferences backup file is untrusted input, so restoring one
 * must not repoint the wallet's trust configuration. These checks pin the
 * import scope: organisational fields are reapplied, while token metadata, RPC
 * overrides, custom networks, the NFT indexer, Nostr relay, watched NFTs, the STRK20
 * service routing, the approval surface, and the saved contacts behind the
 * address-poisoning guard keep their stored values. They also pin that a
 * restore stays the recovery path out of an unreadable stored record.
 */
import { describe, expect, test } from "bun:test";
import {
  createPreferencesStore,
  defaultWalletPreferences,
  PREFERENCES_STORE_KEY,
  type WalletPreferences,
} from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";

const HOSTILE_RPC = "https://attacker.example/rpc";
const HOSTILE_INDEXER = "https://attacker.example/indexer";
const HOSTILE_PROVER = "https://attacker.example/prover";
const HOSTILE_NOSTR_RELAY = "wss://attacker.example";
const MINE_RPC = "https://rpc.example/mine";
const MINE_INDEXER = "https://indexer.example/mine";
const MINE_NOSTR_RELAY = "wss://relay.example/mine";

// A structurally valid backup — it passes `isWalletPreferences` — whose every
// field an attacker would want to control is set to an attacker value.
const hostileBackup = (): WalletPreferences => ({
  ...defaultWalletPreferences(),
  accountLabels: { "SN_MAIN:0x1": "Imported label" },
  activeNetworkId: "SN_SEPOLIA",
  addressBook: [
    { address: "0x9", id: "SN_MAIN:0x9", label: "Imported contact", networkId: "SN_MAIN" },
  ],
  approvalSurface: "popup",
  customNetworks: [
    {
      chainId: "0x534e5f4d41494e",
      id: "attacker-chain",
      name: "Attacker chain",
      rpcUrls: [HOSTILE_RPC],
    },
  ],
  displayCurrency: "eur",
  groups: [{ accountIds: [], icon: "folder", id: "imported", name: "Imported" }],
  hiddenTokens: [`SN_MAIN:STRK:${STRK_TOKEN_ADDRESS}`],
  nftIndexerUrl: HOSTILE_INDEXER,
  nfts: [{ contract: "0x7", id: "SN_MAIN:0x7:1", networkId: "SN_MAIN", tokenId: "1" }],
  nostrRelayUrl: HOSTILE_NOSTR_RELAY,
  rpcOverrides: { SN_MAIN: HOSTILE_RPC },
  strk20Networks: {
    SN_MAIN: {
      discoveryUrl: "https://attacker.example/discovery",
      ohttpEnabled: false,
      poolAddress: STRK_TOKEN_ADDRESS,
      proverUrl: HOSTILE_PROVER,
    },
  },
  theme: "light",
  // Same STRK token id, but two decimals and a renamed symbol source: the
  // amount the review card would format for a transfer changes by 10^16.
  tokens: [
    {
      address: STRK_TOKEN_ADDRESS,
      decimals: 2,
      id: `SN_MAIN:STRK:${STRK_TOKEN_ADDRESS}`,
      name: "Starknet Token",
      networkId: "SN_MAIN",
      symbol: "STRK",
    },
  ],
});

// Round-trips through JSON exactly as the settings page does with a chosen file.
const asBackupFile = (preferences: WalletPreferences): unknown =>
  JSON.parse(JSON.stringify(preferences)) as unknown;

const seededStore = async (): Promise<ReturnType<typeof createPreferencesStore>> => {
  const preferences = createPreferencesStore({ store: createMemoryStore() });
  await preferences.setRpcOverride({ networkId: "SN_MAIN", rpcUrl: MINE_RPC });
  await preferences.setNftIndexerUrl({ url: MINE_INDEXER });
  await preferences.setNostrRelayUrl({ relayUrl: MINE_NOSTR_RELAY });
  await preferences.addCustomNetwork({
    chainId: "0x534e5f474f45524c49",
    id: "mine",
    name: "My chain",
    rpcUrls: [MINE_RPC],
  });
  await preferences.addNft({ contract: "0x5", networkId: "SN_MAIN", tokenId: "3" });
  await preferences.setDisplay({ approvalSurface: "side-panel", theme: "dark" });
  return preferences;
};

describe("importPreferences trust scope", () => {
  test("refuses to restore trust-bearing configuration from a backup", async () => {
    const preferences = await seededStore();
    const before = await preferences.read();

    const next = await preferences.importPreferences(asBackupFile(hostileBackup()));

    expect(next.tokens).toEqual(before.tokens);
    expect(next.rpcOverrides).toEqual({ SN_MAIN: MINE_RPC });
    expect(next.nftIndexerUrl).toBe(MINE_INDEXER);
    expect(next.nostrRelayUrl).toBe(MINE_NOSTR_RELAY);
    expect(next.customNetworks).toEqual(before.customNetworks);
    expect(next.nfts).toEqual(before.nfts);
    expect(next.strk20Networks).toEqual(before.strk20Networks);
    expect(next.approvalSurface).toBe("side-panel");
    expect(next.addressBook).toEqual(before.addressBook);
    // The persisted record must match what the caller was told was applied.
    await expect(preferences.read()).resolves.toEqual(next);
  });

  test("restores the organisational fields a backup is meant to carry", async () => {
    const preferences = await seededStore();

    const next = await preferences.importPreferences(asBackupFile(hostileBackup()));

    expect(next.accountLabels).toEqual({ "SN_MAIN:0x1": "Imported label" });
    expect(next.activeNetworkId).toBe("SN_SEPOLIA");
    expect(next.displayCurrency).toBe("eur");
    expect(next.groups).toEqual([
      { accountIds: [], icon: "folder", id: "imported", name: "Imported" },
    ]);
    expect(next.hiddenTokens).toEqual([`SN_MAIN:STRK:${STRK_TOKEN_ADDRESS}`]);
    expect(next.theme).toBe("light");
  });

  test("keeps stored organisational values a backup omits", async () => {
    const preferences = await seededStore();
    await preferences.setDisplay({ displayCurrency: "gbp", theme: "light" });
    await preferences.setAccountLabel({ accountId: "SN_MAIN:0x1", label: "Kept label" });
    const legacy: Record<string, unknown> = { ...defaultWalletPreferences() };
    for (const key of ["accountLabels", "displayCurrency", "groups", "hiddenTokens", "theme"]) {
      delete legacy[key];
    }

    const next = await preferences.importPreferences(asBackupFile(legacy as WalletPreferences));

    expect(next.accountLabels).toEqual({ "SN_MAIN:0x1": "Kept label" });
    expect(next.displayCurrency).toBe("gbp");
    expect(next.theme).toBe("light");
    // Omitted fields must not be written back as `undefined`: that would fail
    // the JSON guard in `writePreferences` and lose the stored value.
    await expect(preferences.read()).resolves.toEqual(next);
  });

  test("never deletes, relabels, or plants an address-book contact", async () => {
    const preferences = await seededStore();
    const saved = {
      address: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      networkId: "SN_MAIN" as const,
    };
    const savedId = `SN_MAIN:${saved.address}`;
    await preferences.saveAddress({ ...saved, label: "My exchange" });

    // An emptied book must not wipe the reference set the address-poisoning
    // guard compares a recipient against.
    const emptied = await preferences.importPreferences(
      asBackupFile({ ...defaultWalletPreferences(), addressBook: [] }),
    );
    expect(emptied.addressBook.find((entry) => entry.id === savedId)).toEqual({
      ...saved,
      id: savedId,
      label: "My exchange",
    });

    // Nor may a file relabel that contact or add a recipient of its own: an
    // imported entry renders as a one-tap recipient in every send picker.
    const hostileBook = await preferences.importPreferences(
      asBackupFile({
        ...defaultWalletPreferences(),
        addressBook: [
          { ...saved, id: savedId, label: "Attacker relabel" },
          { address: "0x9", id: "SN_MAIN:0x9", label: "Exchange deposit", networkId: "SN_MAIN" },
        ],
      }),
    );
    expect(hostileBook.addressBook).toEqual([{ ...saved, id: savedId, label: "My exchange" }]);
    await expect(preferences.read()).resolves.toEqual(hostileBook);
  });

  test("restores over a stored record this build cannot read", async () => {
    const store = createMemoryStore();
    // A record from a newer build: `hasOnlyKnownKeys` rejects it, so `read`
    // throws and the wallet has no other way back to a usable state.
    await store.set(PREFERENCES_STORE_KEY, {
      ...JSON.parse(JSON.stringify(defaultWalletPreferences())),
      unknownFutureKey: true,
    });
    const preferences = createPreferencesStore({ store });
    await expect(preferences.read()).rejects.toThrow("Invalid stored preferences");

    const next = await preferences.importPreferences(
      asBackupFile({ ...defaultWalletPreferences(), displayCurrency: "gbp", theme: "light" }),
    );

    expect(next.displayCurrency).toBe("gbp");
    expect(next.theme).toBe("light");
    // Recovery lands on defaults, never on the unreadable record's contents.
    expect(next.rpcOverrides).toEqual({});
    await expect(preferences.read()).resolves.toEqual(next);
  });

  test("still rejects a backup that fails validation outright", async () => {
    const preferences = await seededStore();

    await expect(
      preferences.importPreferences({
        ...defaultWalletPreferences(),
        rpcOverrides: { SN_MAIN: 7 },
      }),
    ).rejects.toThrow("Invalid preferences backup");
    expect((await preferences.read()).rpcOverrides).toEqual({ SN_MAIN: MINE_RPC });
  });
});
