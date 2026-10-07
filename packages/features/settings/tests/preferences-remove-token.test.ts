/**
 * Tracked-token removal (Sherlock audit 134): the user's way out of a token a dapp
 * added through `wallet_watchAsset`. Built-in defaults stay tracked.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";

const dappToken = {
  address: "0xbadc0ffee",
  decimals: 18,
  name: "Prize Token",
  networkId: "SN_MAIN",
  symbol: "PRZ",
} as const;

const seeded = async () => {
  const store = createPreferencesStore({ store: createMemoryStore() });
  const added = await store.upsertToken(dappToken, "dapp");
  const tokenId = added.tokens.at(-1)?.id ?? "";
  await store.setTokenHidden({ hidden: true, tokenId });
  return { store, tokenId };
};

describe("removeToken", () => {
  test("removes a dapp-added token and its hidden flag", async () => {
    const { store, tokenId } = await seeded();
    const next = await store.removeToken({ tokenId });
    expect(next.tokens.some((token) => token.id === tokenId)).toBe(false);
    expect(next.hiddenTokens).not.toContain(tokenId);
    expect((await store.read()).tokens.some((token) => token.id === tokenId)).toBe(false);
  });

  test("refuses a built-in default token", async () => {
    const { store } = await seeded();
    const eth = (await store.read()).tokens.find(
      (token) => token.networkId === "SN_MAIN" && token.symbol === "ETH",
    );
    await expect(store.removeToken({ tokenId: eth?.id ?? "" })).rejects.toThrow(
      "Built-in tokens can't be removed",
    );
    expect((await store.read()).tokens.some((token) => token.id === eth?.id)).toBe(true);
  });

  test("refuses an unknown or malformed id", async () => {
    const { store } = await seeded();
    await expect(store.removeToken({ tokenId: "SN_MAIN:NOPE:0x1" })).rejects.toThrow(
      "Token not found",
    );
    await expect(store.removeToken({ tokenId: "" })).rejects.toThrow("Invalid token");
  });
});
