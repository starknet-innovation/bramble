/**
 * Tracked-token removal (Sherlock audit 134): the user's way out of a token a dapp
 * added through `wallet_watchAsset`. Built-in defaults stay tracked.
 */
import { describe, expect, test } from "bun:test";
import {
  createPreferencesStore,
  isWalletPreferences,
  wasTokenRemoved,
} from "@bramble/settings/preferences";
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

describe("removed tokens are remembered (issue 663)", () => {
  const usdc = {
    address: "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb",
    networkId: "SN_MAIN",
  } as const;

  test("a new wallet tracks native USDC on mainnet, and the user can remove it", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });
    const seeded = (await store.read()).tokens.find(
      (token) => token.networkId === "SN_MAIN" && token.symbol === "USDC",
    );
    expect(seeded?.address).toBe(usdc.address);
    const next = await store.removeToken({ tokenId: seeded?.id ?? "" });
    expect(next.tokens.some((token) => token.id === seeded?.id)).toBe(false);
    expect(wasTokenRemoved(next, usdc.networkId, usdc.address)).toBe(true);
    // Any spelling of the address, but only on the network it was removed from.
    expect(wasTokenRemoved(next, "SN_MAIN", `0x${BigInt(usdc.address).toString(16)}`)).toBe(true);
    expect(wasTokenRemoved(next, "SN_SEPOLIA", usdc.address)).toBe(false);
  });

  test("adding the token again lifts the removal", async () => {
    const { store, tokenId } = await seeded();
    const removed = await store.removeToken({ tokenId });
    expect(wasTokenRemoved(removed, dappToken.networkId, dappToken.address)).toBe(true);
    const readded = await store.upsertToken(dappToken, "user");
    expect(wasTokenRemoved(readded, dappToken.networkId, dappToken.address)).toBe(false);
    expect((await store.read()).removedTokens).toEqual([]);
  });

  test("preferences without the field read as nothing removed", () => {
    expect(wasTokenRemoved({}, usdc.networkId, usdc.address)).toBe(false);
  });

  test("the stored list validates and is bounded", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });
    for (let index = 0; index < 70; index += 1) {
      const address = `0x${(0x5000 + index).toString(16)}`;
      const added = await store.upsertToken({ ...dappToken, address, symbol: `R${index}` }, "user");
      const id = added.tokens.find((token) => BigInt(token.address) === BigInt(address))?.id;
      await store.removeToken({ tokenId: id ?? "" });
    }
    const stored = await store.read();
    expect(isWalletPreferences(stored)).toBe(true);
    expect(stored.removedTokens).toHaveLength(64);
    // The oldest removal is the one dropped.
    expect(wasTokenRemoved(stored, "SN_MAIN", "0x5000")).toBe(false);
    expect(wasTokenRemoved(stored, "SN_MAIN", `0x${(0x5000 + 69).toString(16)}`)).toBe(true);
    expect(isWalletPreferences({ ...stored, removedTokens: [1] })).toBe(false);
    expect(isWalletPreferences({ ...stored, removedTokens: ["a", "a"] })).toBe(false);
  });
});
