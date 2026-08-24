/**
 * MCW-V09-110: one address must be one stored record, enforced by the id
 * builder and the entry validator — not by call-site discipline.
 *
 * The first attempt canonicalized only in the Add-token message parser. That
 * closed every reachable caller but left the storage layer able to mint a
 * second, numerically-equal record: `upsertToken({address: minimal-form ETH})`
 * produced a third Mainnet token whose address equalled the seeded one, and the
 * private-balance read refuses a request carrying two numerically-equal token
 * addresses outright — killing the whole privacy surface for that account with
 * no removeToken API to undo it.
 *
 * These pin (a) the invariant living inside `withTokenId`/`withAddressBookId`
 * and `isTokenConfig`/`isAddressBookEntry`, and (b) the repair path for a vault
 * that ALREADY holds the duplicate: normalization runs before validation on
 * read, so an affected user is healed rather than locked out.
 */
import { describe, expect, test } from "bun:test";
import {
  createPreferencesStore,
  defaultWalletPreferences,
  PREFERENCES_STORE_KEY,
} from "@mc-wallet/settings/preferences";
import { createMemoryStore } from "@mc-wallet/store/kv";
import { canonicalAddress } from "@mc-wallet/wallet-model/networks";
import {
  isAddressBookEntry,
  isTokenConfig,
  withAddressBookId,
  withTokenId,
} from "@mc-wallet/wallet-model/preferences";
import {
  isWalletPreferences,
  normalizeStoredPreferences,
} from "../../packages/features/settings/src/preferences-stored";

// The seeded Mainnet ETH spelling, and the spelling the Add-token field's
// normalizeFeltInput produces for the very same address.
const ETH_PADDED = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const ETH_MINIMAL = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

const ethRecord = (address: string) => ({
  address,
  decimals: 18,
  name: "Ether",
  networkId: "SN_MAIN" as const,
  symbol: "ETH",
});

describe("entry id builders own the canonical-address invariant", () => {
  test("withTokenId canonicalizes the address it stores and the id it derives", () => {
    const minimal = withTokenId(ethRecord(ETH_MINIMAL));

    expect(minimal.address).toBe(ETH_PADDED);
    expect(minimal.id).toBe(withTokenId(ethRecord(ETH_PADDED)).id);
    // A checksummed (mixed-case) paste folds to the same record too.
    expect(withTokenId(ethRecord(ETH_PADDED.toUpperCase().replace("0X", "0x"))).id).toBe(
      minimal.id,
    );
  });

  test("withAddressBookId applies the same rule to contacts", () => {
    const minimal = withAddressBookId({
      address: ETH_MINIMAL,
      label: "Friend",
      networkId: "SN_MAIN",
      publicKeyX: "0x000abc",
    });

    expect(minimal.address).toBe(ETH_PADDED);
    expect(minimal.id).toBe(`SN_MAIN:${ETH_PADDED}`);
    expect(minimal.publicKeyX).toBe("0xabc");
  });

  test("the entry validators reject a non-canonical spelling outright", () => {
    expect(isTokenConfig({ ...ethRecord(ETH_MINIMAL), id: `SN_MAIN:ETH:${ETH_MINIMAL}` })).toBe(
      false,
    );
    expect(isTokenConfig(withTokenId(ethRecord(ETH_MINIMAL)))).toBe(true);
    expect(
      isAddressBookEntry({
        address: ETH_MINIMAL,
        id: `SN_MAIN:${ETH_MINIMAL}`,
        label: "Friend",
        networkId: "SN_MAIN",
      }),
    ).toBe(false);
  });
});

describe("the store cannot mint a numerically-equal second record", () => {
  test("upsertToken with the minimal spelling replaces the seeded record", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });

    const next = await store.upsertToken(ethRecord(ETH_MINIMAL));

    const mainnet = next.tokens.filter((token) => token.networkId === "SN_MAIN");
    // Two seeded Mainnet tokens (ETH, STRK) — not three.
    expect(mainnet).toHaveLength(2);
    const numeric = mainnet.map((token) => BigInt(token.address));
    expect(new Set(numeric).size).toBe(numeric.length);
    expect(mainnet.find((token) => token.symbol === "ETH")?.address).toBe(ETH_PADDED);
  });

  test("saveAddress with the minimal spelling replaces the stored contact", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });

    await store.saveAddress({ address: ETH_PADDED, label: "Friend", networkId: "SN_MAIN" });
    const next = await store.saveAddress({
      address: ETH_MINIMAL,
      label: "Friend renamed",
      networkId: "SN_MAIN",
    });

    expect(next.addressBook).toHaveLength(1);
    expect(next.addressBook[0]).toMatchObject({ address: ETH_PADDED, label: "Friend renamed" });
  });
});

describe("an already-duplicated vault is repaired on read", () => {
  // Exactly the record shipped v0.9 could write: the seeded padded ETH plus a
  // hand-added minimal ETH, with the duplicate hidden by its old id.
  const affectedRecord = () => {
    const defaults = defaultWalletPreferences();
    const duplicate = {
      ...ethRecord(ETH_MINIMAL),
      id: `SN_MAIN:ETH:${ETH_MINIMAL}`,
    };
    return {
      ...defaults,
      hiddenTokens: [duplicate.id],
      tokens: [...defaults.tokens, duplicate],
    };
  };

  test("collapses the duplicate and carries its hidden-token id across", async () => {
    const kv = createMemoryStore();
    await kv.set(PREFERENCES_STORE_KEY, JSON.parse(JSON.stringify(affectedRecord())));
    const store = createPreferencesStore({ store: kv });

    const preferences = await store.read();

    const mainnet = preferences.tokens.filter((token) => token.networkId === "SN_MAIN");
    expect(mainnet).toHaveLength(2);
    const numeric = mainnet.map((token) => BigInt(token.address));
    expect(new Set(numeric).size).toBe(numeric.length);
    // The surviving record is the seeded one, and the hide the user applied to
    // the duplicate now names it rather than a token id that no longer exists.
    const eth = mainnet.find((token) => token.symbol === "ETH");
    expect(eth?.address).toBe(ETH_PADDED);
    expect(preferences.hiddenTokens).toEqual([eth?.id ?? ""]);
  });

  test("the affected record would otherwise fail the strict validator", () => {
    // Without normalization this is what read() would see — the exact reason
    // normalization must run BEFORE validation rather than after it.
    expect(isWalletPreferences(affectedRecord())).toBe(false);
    expect(isWalletPreferences(normalizeStoredPreferences(affectedRecord()))).toBe(true);
  });

  test("normalization is deterministic and leaves a clean record alone", () => {
    const clean = defaultWalletPreferences();
    const once = normalizeStoredPreferences(clean);

    expect(once).toEqual(clean);
    expect(normalizeStoredPreferences(once)).toEqual(once);
    expect(normalizeStoredPreferences(normalizeStoredPreferences(affectedRecord()))).toEqual(
      normalizeStoredPreferences(affectedRecord()),
    );
  });

  test("canonicalizes legacy account-label and group ids deterministically", () => {
    const defaults = defaultWalletPreferences();
    const normalized = normalizeStoredPreferences({
      ...defaults,
      accountLabels: { "SN_MAIN:0x0123": "Primary" },
      groups: [
        {
          accountIds: ["SN_MAIN:0x0123", "SN_MAIN:0x123"],
          icon: "folder",
          id: "main",
          name: "Main",
        },
      ],
    });

    expect(normalized).toMatchObject({
      accountLabels: { "SN_MAIN:0x123": "Primary" },
      groups: [{ accountIds: ["SN_MAIN:0x123"] }],
    });
    expect(isWalletPreferences(normalized)).toBe(true);
  });

  test("a value that is not a preferences record passes through untouched", () => {
    expect(normalizeStoredPreferences(undefined)).toBeUndefined();
    expect(normalizeStoredPreferences("nonsense")).toBe("nonsense");
    // An unreadable token row is left exactly as stored for the validator to
    // reject, never reshaped into something that would pass.
    expect(
      normalizeStoredPreferences({ addressBook: [], tokens: [{ nonsense: true }] }),
    ).toMatchObject({ tokens: [{ nonsense: true }] });
  });

  test("canonicalAddress is the one shared spelling rule", () => {
    expect(canonicalAddress(ETH_MINIMAL)).toBe(ETH_PADDED);
    expect(canonicalAddress("0x0")).toBeNull();
    expect(canonicalAddress("not-hex")).toBeNull();
  });
});
