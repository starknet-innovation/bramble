/**
 * Custom-network persistence checks: wallet_addStarknetChain stores a validated
 * custom chain, dedupes by normalized chain id, and rejects malformed input.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "../../src/storage/kv";
import { createPreferencesStore } from "../../src/storage/preferences-store";

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
