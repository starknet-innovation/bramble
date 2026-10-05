/**
 * Custom-network persistence checks: wallet_addStarknetChain stores a validated
 * custom chain, dedupes by normalized chain id, and rejects malformed input.
 */
import { describe, expect, test } from "bun:test";
import { isJson, type Json } from "@bramble/core/json";
import {
  createPreferencesStore,
  defaultWalletPreferences,
  MAX_CUSTOM_NETWORKS,
  PREFERENCES_STORE_KEY,
} from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";

const chain = {
  chainId: "0x534e5f4b4154414e41",
  id: "katana",
  name: "Katana",
  rpcUrls: ["https://rpc.katana.example"] as const,
};

describe("preferences custom networks", () => {
  test("persists a validated custom network", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });
    const next = await store.addCustomNetwork(chain);
    expect(next.customNetworks).toEqual([chain]);
    const reread = await store.read();
    expect(reread.customNetworks).toEqual([chain]);
  });

  test("dedupes by normalized chain id rather than appending", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });
    await store.addCustomNetwork(chain);
    const next = await store.addCustomNetwork({
      ...chain,
      chainId: "0x0534e5f4b4154414e41",
      name: "Katana Renamed",
    });
    expect(next.customNetworks).toHaveLength(1);
    expect(next.customNetworks?.[0]?.name).toBe("Katana Renamed");
  });

  test("rejects a malformed custom network", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });
    await expect(store.addCustomNetwork({ ...chain, chainId: "not-hex" })).rejects.toThrow();
    await expect(store.addCustomNetwork({ ...chain, rpcUrls: ["ftp://nope"] })).rejects.toThrow();
  });
});

// Sherlock audit 153: dapp-added networks were unbounded and kept every URL a
// dapp sent, so approved add-chain cards could fill the 1 MiB record and wedge
// every later token, contact and group write.
describe("custom network bounds (Sherlock audit 153)", () => {
  const network = (index: number) => ({
    chainId: `0x${(0x1000 + index).toString(16)}`,
    id: `chain-${index}`,
    name: `Chain ${index}`,
  });

  test("keeps the newest sixteen networks, evicting the oldest", async () => {
    const memory = createMemoryStore();
    const store = createPreferencesStore({ store: memory });
    for (let index = 1; index <= 17; index += 1) {
      await store.addCustomNetwork(network(index));
    }
    const stored = (await store.read()).customNetworks ?? [];
    expect(stored).toHaveLength(MAX_CUSTOM_NETWORKS);
    expect(stored[0]?.id).toBe("chain-2");
    expect(stored.at(-1)?.id).toBe("chain-17");
    const raw = (await memory.get(PREFERENCES_STORE_KEY)) as { customNetworks: unknown[] };
    expect(raw.customNetworks).toHaveLength(MAX_CUSTOM_NETWORKS);
  });

  test("stores only the first RPC URL of a network", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });
    const next = await store.addCustomNetwork({
      ...chain,
      blockExplorerUrls: ["https://explorer.katana.example"],
      iconUrls: ["https://icons.katana.example/a.png"],
      rpcUrls: ["https://rpc.katana.example", "https://rpc2.katana.example"],
    });
    expect(next.customNetworks).toEqual([chain]);
  });

  // A record an earlier build wrote: one network carrying as many 2 KB URLs
  // as the budget allows, padded so it sits just under the 1 MiB limit.
  const wedgedRecord = (): Record<string, unknown> => {
    const base = defaultWalletPreferences();
    const url = (index: number, length: number) =>
      `https://rpc.example/${index}/${"a".repeat(length)}`;
    const withUrls = (count: number, pad: number) => ({
      ...base,
      customNetworks: [
        {
          ...chain,
          iconUrls: [url(0, pad)],
          rpcUrls: Array.from({ length: count }, (_, index) => url(index, 2000)),
        },
      ],
    });
    const largest = (fits: (size: number) => boolean, high: number): number => {
      let low = 1;
      let top = high;
      while (low < top) {
        const mid = Math.ceil((low + top) / 2);
        if (fits(mid)) low = mid;
        else top = mid - 1;
      }
      return low;
    };
    const count = largest((size) => isJson(withUrls(size, 1)), 200);
    const pad = largest((size) => isJson(withUrls(count, size)), 2000);
    return withUrls(count, pad);
  };

  test("a filled stored record shrinks on read and writes work again", async () => {
    const memory = createMemoryStore();
    const seeded = wedgedRecord();
    expect(isJson(seeded)).toBe(true);
    await memory.set(PREFERENCES_STORE_KEY, seeded as Json);
    const store = createPreferencesStore({ store: memory });

    await store.upsertToken(
      {
        address: "0x0123456789abcdef",
        decimals: 6,
        name: "Test Token",
        networkId: "SN_MAIN",
        symbol: "TST",
      },
      "user",
    );
    await store.saveAddress({
      address: "0x0abcdef",
      label: "Desk",
      networkId: "SN_MAIN",
    });
    await store.createGroup({ icon: "folder", name: "Savings" });
    const firstRpc = (seeded["customNetworks"] as { rpcUrls: string[] }[])[0]?.rpcUrls[0] ?? "";
    const compacted = [
      { chainId: chain.chainId, id: chain.id, name: chain.name, rpcUrls: [firstRpc] },
    ];
    expect((await store.read()).customNetworks).toEqual(compacted);
    const stored = await memory.get(PREFERENCES_STORE_KEY);
    expect((stored as { customNetworks: unknown }).customNetworks).toEqual(compacted);
  });
});
