/**
 * Token source tracking (audit 171): the preferences store records which tracked
 * tokens a dapp added (wallet_watchAsset) in `dappTokenIds`, and an explicit
 * user add clears the mark. The call reviewer reads it to keep dapp-supplied
 * metadata from passing as trusted.
 */
import { describe, expect, test } from "bun:test";
import {
  createPreferencesStore,
  defaultWalletPreferences,
  isWalletPreferences,
  PREFERENCES_STORE_KEY,
} from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { withTokenId } from "@bramble/wallet-model/preferences";

const PLAIN = {
  address: "0x0777000000000000000000000000000000000000000000000000000000000002",
  decimals: 6,
  name: "Plain",
  networkId: "SN_SEPOLIA" as const,
  symbol: "PLAIN",
};
const plainId = withTokenId(PLAIN).id;

describe("upsertToken records the token source", () => {
  test("a dapp add marks the id once, however often it is repeated", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });
    await store.upsertToken(PLAIN, "dapp");
    const next = await store.upsertToken(PLAIN, "dapp");
    expect(next.dappTokenIds).toEqual([plainId]);
    expect(next.tokens.filter((token) => token.id === plainId)).toHaveLength(1);
  });

  test("a user add clears the dapp mark", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });
    await store.upsertToken(PLAIN, "dapp");
    const next = await store.upsertToken(PLAIN, "user");
    expect(next.dappTokenIds).toEqual([]);
    expect((await store.read()).dappTokenIds).toEqual([]);
  });

  test("an unknown source is refused and writes nothing", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });
    await expect(store.upsertToken(PLAIN, "site" as never)).rejects.toThrow("Invalid token");
    expect((await store.read()).tokens.some((token) => token.id === plainId)).toBe(false);
  });
});

describe("stored dappTokenIds", () => {
  test("validates as an optional list of unique token ids", () => {
    const defaults = defaultWalletPreferences();
    expect(isWalletPreferences(defaults)).toBe(true);
    expect(isWalletPreferences({ ...defaults, dappTokenIds: [plainId] })).toBe(true);
    expect(isWalletPreferences({ ...defaults, dappTokenIds: plainId })).toBe(false);
    expect(isWalletPreferences({ ...defaults, dappTokenIds: [plainId, plainId] })).toBe(false);
    expect(isWalletPreferences({ ...defaults, dappTokenIds: [""] })).toBe(false);
  });

  test("follows a token id renamed by read-time normalization", async () => {
    // A minimal-spelling address is re-derived to the padded id on read; the
    // dapp mark must follow it rather than name an id that no longer exists.
    const minimal = {
      ...PLAIN,
      address: "0x777000000000000000000000000000000000000000000000000000000000002",
    };
    const legacyId = `SN_SEPOLIA:PLAIN:${minimal.address}`;
    const defaults = defaultWalletPreferences();
    const kv = createMemoryStore();
    await kv.set(
      PREFERENCES_STORE_KEY,
      JSON.parse(
        JSON.stringify({
          ...defaults,
          dappTokenIds: [legacyId],
          tokens: [...defaults.tokens, { ...minimal, id: legacyId }],
        }),
      ),
    );
    const preferences = await createPreferencesStore({ store: kv }).read();
    expect(preferences.dappTokenIds).toEqual([plainId]);
  });
});
