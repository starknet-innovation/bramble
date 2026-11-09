/**
 * `upsertToken` bounds what the tracked list can hold: one record per address
 * on a network, and at most `MAX_ADDED_TOKENS_PER_NETWORK` added tokens beside
 * the built-in defaults. Both keep the private balance read (64 distinct
 * addresses at most) working however many watch-asset cards were approved.
 */
import { describe, expect, test } from "bun:test";
import {
  createPreferencesStore,
  MAX_ADDED_TOKENS_PER_NETWORK,
} from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";

const added = (index: number, networkId: "SN_MAIN" | "SN_SEPOLIA" = "SN_MAIN") => ({
  address: `0x${(0x1000 + index).toString(16)}`,
  decimals: 18,
  name: `Token ${index}`,
  networkId,
  symbol: `T${index}`,
});

const filled = async () => {
  const store = createPreferencesStore({ store: createMemoryStore() });
  for (let index = 1; index <= MAX_ADDED_TOKENS_PER_NETWORK; index += 1) {
    await store.upsertToken(added(index), "user");
  }
  return store;
};

describe("upsertToken", () => {
  test("keeps one record when an address comes back under another symbol", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });
    await store.upsertToken({ ...added(1), symbol: "AAA" }, "dapp");
    const next = await store.upsertToken(
      { ...added(1), address: "0x00001001", symbol: "BBB" },
      "dapp",
    );
    const matching = next.tokens.filter((token) => BigInt(token.address) === 0x1001n);
    expect(matching.map((token) => token.symbol)).toEqual(["AAA"]);
    expect(next.dappTokenIds).toEqual(matching.map((token) => token.id));
  });

  test("a user add replaces a dapp record at the same address and trusts it (audit 171)", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });
    const dapp = await store.upsertToken({ ...added(1), symbol: "AAA" }, "dapp");
    const dappId = dapp.tokens.find((token) => BigInt(token.address) === 0x1001n)?.id ?? "";
    await store.setTokenHidden({ hidden: true, tokenId: dappId });
    const next = await store.upsertToken({ ...added(1), symbol: "BBB" }, "user");
    const matching = next.tokens.filter((token) => BigInt(token.address) === 0x1001n);
    expect(matching.map((token) => token.symbol)).toEqual(["BBB"]);
    expect(next.dappTokenIds).toEqual([]);
    expect(next.hiddenTokens).toEqual(matching.map((token) => token.id));
  });

  test("still replaces the record with the same id", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });
    await store.upsertToken(added(1), "user");
    const next = await store.upsertToken({ ...added(1), name: "Renamed" }, "user");
    const matching = next.tokens.filter((token) => BigInt(token.address) === 0x1001n);
    expect(matching.map((token) => token.name)).toEqual(["Renamed"]);
  });

  test("tracks the same address on another network", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });
    await store.upsertToken(added(1), "user");
    const next = await store.upsertToken(added(1, "SN_SEPOLIA"), "user");
    expect(next.tokens.filter((token) => BigInt(token.address) === 0x1001n)).toHaveLength(2);
  });

  test("refuses one more added token past the cap and keeps the list", async () => {
    const store = await filled();
    const before = await store.read();
    await expect(
      store.upsertToken(added(MAX_ADDED_TOKENS_PER_NETWORK + 1), "dapp"),
    ).rejects.toThrow(
      `You can track up to ${MAX_ADDED_TOKENS_PER_NETWORK} added tokens on a network.`,
    );
    expect((await store.read()).tokens).toEqual(before.tokens);
  });

  test("at the cap, an update to a tracked token and another network still work", async () => {
    const store = await filled();
    await expect(
      store.upsertToken({ ...added(1), name: "Renamed" }, "user"),
    ).resolves.toBeDefined();
    await expect(store.upsertToken(added(1, "SN_SEPOLIA"), "user")).resolves.toBeDefined();
  });

  test("built-in defaults do not count toward the cap", async () => {
    const store = await filled();
    const mainnet = (await store.read()).tokens.filter((token) => token.networkId === "SN_MAIN");
    expect(mainnet.length).toBeGreaterThan(MAX_ADDED_TOKENS_PER_NETWORK);
    // The whole mainnet list still fits the private balance read.
    expect(mainnet.length).toBeLessThanOrEqual(64);
  });
});
