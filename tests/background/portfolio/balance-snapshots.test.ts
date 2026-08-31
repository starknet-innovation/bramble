/** Durable balance snapshots stay scoped, validated, and bounded. */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@mc-wallet/settings/preferences";
import { getTokenBalances } from "@mc-wallet/starknet/rpc";
import { createMemoryStore } from "@mc-wallet/store/kv";
import type { RpcProvider } from "starknet";
import {
  BALANCE_SNAPSHOTS_KEY,
  cachedBalances,
  createBalanceSnapshotStore,
} from "../../../apps/extension/src/background/portfolio/balance-snapshots";

const token = defaultWalletPreferences().tokens[0];
if (!token) throw new Error("token fixture unavailable");
const balances = [{ ...token, balance: "42", formatted: "42" }];

describe("balance snapshots", () => {
  test("survives recreation and never crosses account scope", async () => {
    const storage = createMemoryStore();
    const snapshots = createBalanceSnapshotStore(storage);
    await snapshots.write({
      accountId: "SN_MAIN:0x1",
      balances,
      fetchedAt: 42,
      networkId: "SN_MAIN",
    });

    const restored = createBalanceSnapshotStore(storage);
    expect(await restored.read("SN_MAIN:0x1", "SN_MAIN")).toEqual({ balances, fetchedAt: 42 });
    expect(await restored.read("SN_MAIN:0x2", "SN_MAIN")).toBeNull();
  });

  test("drops malformed storage and caps retained account scopes", async () => {
    const storage = createMemoryStore();
    await storage.set(BALANCE_SNAPSHOTS_KEY, [
      { accountId: "wrong", balances: [], networkId: "SN_MAIN" },
    ]);
    const snapshots = createBalanceSnapshotStore(storage);
    expect(await snapshots.read("SN_MAIN:0x1", "SN_MAIN")).toBeNull();

    for (let index = 1; index <= 51; index += 1) {
      await snapshots.write({
        accountId: `SN_MAIN:0x${index.toString(16)}`,
        balances,
        fetchedAt: index,
        networkId: "SN_MAIN",
      });
    }
    expect(await snapshots.read("SN_MAIN:0x1", "SN_MAIN")).toBeNull();
    expect(await snapshots.read("SN_MAIN:0x33", "SN_MAIN")).toEqual({
      balances,
      fetchedAt: 51,
    });
  });

  test("reuses fresh data, shares refreshes, and keeps stale data on failure", async () => {
    const snapshots = createBalanceSnapshotStore(createMemoryStore());
    let loads = 0;
    const load = async () => {
      loads += 1;
      await Promise.resolve();
      return balances;
    };
    const input = {
      accountId: "SN_MAIN:0x1",
      cachedOnly: false,
      force: false,
      networkId: "SN_MAIN" as const,
      now: 1_000,
    };
    const first = cachedBalances(snapshots, input, load);
    const second = cachedBalances(snapshots, input, load);
    await expect(Promise.all([first, second])).resolves.toEqual([
      { balances, fetchedAt: 1_000, stale: false },
      { balances, fetchedAt: 1_000, stale: false },
    ]);
    expect(loads).toBe(1);

    await cachedBalances(snapshots, { ...input, now: 2_000 }, async () => {
      loads += 1;
      return balances;
    });
    expect(loads).toBe(1);
    await expect(
      cachedBalances(snapshots, { ...input, force: true, now: 3_000 }, async () =>
        Promise.reject(new Error("offline")),
      ),
    ).resolves.toEqual({ balances, fetchedAt: 1_000, stale: true });
  });

  test("keeps the default visible balance lane below ten RPC reads per minute", async () => {
    const tokens = defaultWalletPreferences().tokens.filter(
      (candidate) => candidate.networkId === "SN_MAIN",
    );
    expect(tokens).toHaveLength(2);
    let rpcReads = 0;
    const load = () =>
      getTokenBalances(
        { accountAddress: "0x1", rpcUrls: ["https://rpc.example"], tokens },
        () =>
          ({
            callContract: async () => {
              rpcReads += 1;
              return ["0x1", "0x0"];
            },
          }) as unknown as RpcProvider,
      );
    const snapshots = createBalanceSnapshotStore(createMemoryStore());
    const input = {
      accountId: "SN_MAIN:0x1",
      cachedOnly: false,
      force: false,
      networkId: "SN_MAIN" as const,
      now: 1,
    };

    await cachedBalances(snapshots, input, load);
    await cachedBalances(snapshots, { ...input, now: 59_999 }, load);
    expect(rpcReads).toBe(2);

    await cachedBalances(snapshots, { ...input, now: 60_001 }, load);
    expect(rpcReads).toBe(4);

    await cachedBalances(snapshots, { ...input, force: true, now: 60_002 }, load);
    expect(rpcReads).toBe(6);
  });
});
