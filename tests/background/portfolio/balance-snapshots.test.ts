/** Durable balance snapshots stay scoped, validated, and bounded. */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@mc-wallet/settings/preferences";
import { createMemoryStore } from "@mc-wallet/store/kv";
import {
  BALANCE_SNAPSHOTS_KEY,
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
});
