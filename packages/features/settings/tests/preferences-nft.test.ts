/**
 * Preferences NFT checks: adding a watched NFT, toggling spam, removing, and
 * accepting preferences saved before the nfts key existed.
 */
import { describe, expect, test } from "bun:test";
import {
  createPreferencesStore,
  defaultWalletPreferences,
  PREFERENCES_STORE_KEY,
} from "@mc-wallet/settings/preferences";
import { createMemoryStore } from "@mc-wallet/store/kv";

const CONTRACT = "0x051a2b3c4d";

describe("preferences NFT tracking", () => {
  test("adds, spam-hides, and removes watched NFTs", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });

    await preferences.addNft({
      contract: CONTRACT,
      label: "Punk",
      networkId: "SN_MAIN",
      tokenId: "7",
    });
    const withNft = await preferences.read();
    const id = withNft.nfts?.[0]?.id ?? "";
    expect(withNft.nfts).toHaveLength(1);
    expect(withNft.nfts?.[0]).toMatchObject({
      contract: "0x51a2b3c4d",
      label: "Punk",
      tokenId: "7",
    });

    await preferences.setNftSpam({ id, spam: true });
    expect((await preferences.read()).nfts?.[0]?.spam).toBe(true);

    await preferences.addNft({ contract: CONTRACT, networkId: "SN_MAIN", tokenId: "7" });
    expect((await preferences.read()).nfts).toHaveLength(1);

    await preferences.removeNft(id);
    expect((await preferences.read()).nfts).toEqual([]);
  });

  test("accepts preferences stored before the nfts key existed", async () => {
    const store = createMemoryStore();
    const legacy = { ...defaultWalletPreferences() };
    delete (legacy as Record<string, unknown>)["nfts"];
    await store.set(PREFERENCES_STORE_KEY, JSON.parse(JSON.stringify(legacy)));

    const preferences = await createPreferencesStore({ store }).read();
    expect(preferences.nfts).toBeUndefined();
  });
});
