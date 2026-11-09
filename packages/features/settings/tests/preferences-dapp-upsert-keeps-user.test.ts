/**
 * A dapp card cannot overwrite a token already tracked at its address (#682):
 * an older wallet_watchAsset card approved after the user added the same token
 * by hand leaves the user's record, and its trusted status, as they are.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { withTokenId } from "@bramble/wallet-model/preferences";

const USER = {
  address: "0x0777000000000000000000000000000000000000000000000000000000000002",
  decimals: 6,
  name: "Plain",
  networkId: "SN_SEPOLIA" as const,
  symbol: "PLAIN",
};
const id = withTokenId(USER).id;

describe("a dapp upsert over a tracked address", () => {
  test("keeps the user's record under the same id, untouched and trusted", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });
    const before = await store.upsertToken(USER, "user");
    const after = await store.upsertToken({ ...USER, name: "Plain (from a site)" }, "dapp");

    expect(after.tokens).toEqual(before.tokens);
    expect(after.dappTokenIds ?? []).not.toContain(id);
    expect(after.tokens.find((token) => token.id === id)?.name).toBe("Plain");
    expect((await store.read()).dappTokenIds ?? []).not.toContain(id);
  });

  test("still records a dapp add for an address nobody tracks yet", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });
    const next = await store.upsertToken(USER, "dapp");
    expect(next.dappTokenIds).toEqual([id]);
  });
});
