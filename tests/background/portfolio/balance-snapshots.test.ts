/** Durable balance snapshots stay scoped, validated, and bounded. */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { getTokenBalances } from "@bramble/starknet/rpc";
import { createMemoryStore } from "@bramble/store/kv";
import type { RpcProvider } from "starknet";
import {
  BALANCE_SNAPSHOTS_KEY,
  cachedBalances,
  createBalanceSnapshotStore,
} from "../../../apps/extension/src/background/portfolio/balance-snapshots";
import type { WalletStatus } from "../../../packages/presentation/wallet-ui/src/popup/responses/responses";
import { emptyRenderCache } from "../../../packages/presentation/wallet-ui/src/sidepanel/app/rendering/render-cache";
import { createDeploymentCache } from "../../../packages/presentation/wallet-ui/src/sidepanel/app/sync/deployment-cache";
import { hydrateView } from "../../../packages/presentation/wallet-ui/src/sidepanel/app/sync/hydrate";
import { createSignabilityCache } from "../../../packages/presentation/wallet-ui/src/sidepanel/app/sync/signability-cache";

const token = defaultWalletPreferences().tokens[0];
if (!token) throw new Error("token fixture unavailable");
const balances = [{ ...token, balance: "42", formatted: "42" }];
const status: WalletStatus = {
  accountCount: 1,
  accounts: [],
  activeAccountId: "SN_MAIN:0x1",
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

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
    // ETH, STRK and native USDC (issue 663).
    expect(tokens).toHaveLength(3);
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
    expect(rpcReads).toBe(3);

    await cachedBalances(snapshots, { ...input, now: 60_001 }, load);
    expect(rpcReads).toBe(6);

    await cachedBalances(snapshots, { ...input, force: true, now: 60_002 }, load);
    expect(rpcReads).toBe(9);
  });

  test("keeps repeated Home hydration to one Starknet RPC read per tracked token per fetch", async () => {
    const tokens = defaultWalletPreferences().tokens.filter(
      (candidate) => candidate.networkId === "SN_MAIN",
    );
    const snapshots = createBalanceSnapshotStore(createMemoryStore());
    let now = 1;
    let rpcReads = 0;
    let historyScans = 0;
    const wallet = {
      async discoverNfts() {
        return [];
      },
      async loadActivity(_accountId?: string, _cached?: boolean, refreshHistory = false) {
        if (refreshHistory) historyScans += 1;
        return { entries: [], historyUnavailable: false };
      },
      async loadBalances(cachedOnly = false, force = false) {
        const snapshot = await cachedBalances(
          snapshots,
          {
            accountId: status.activeAccountId ?? "",
            cachedOnly,
            force,
            networkId: status.networkId,
            now,
          },
          () =>
            getTokenBalances(
              { accountAddress: "0x1", rpcUrls: ["https://rpc.example"], tokens },
              () =>
                ({
                  callContract: async () => {
                    rpcReads += 1;
                    return ["0x1", "0x0"];
                  },
                }) as unknown as RpcProvider,
            ),
        );
        return snapshot
          ? {
              accountId: status.activeAccountId ?? "",
              asOf: snapshot.fetchedAt,
              balances: snapshot.balances,
              networkId: status.networkId,
              stale: snapshot.stale,
            }
          : { error: "balance snapshot unavailable" };
      },
      async loadDeploymentStatus() {
        rpcReads += 1;
        return { accountId: status.activeAccountId ?? "", deployed: false };
      },
      // The fixture account is the wallet's own: the background answers its
      // signability from the family alone, with no chain read to count.
      async loadAccountSignability() {
        return { accountId: status.activeAccountId ?? "", ok: true, readOnly: false };
      },
      async loadPrices() {
        return { asOf: null, changes: {}, prices: {}, stale: false };
      },
      async loadWatchedNfts() {
        return [];
      },
    };
    const deployment = createDeploymentCache(wallet as never, () => now);
    const signability = createSignabilityCache(wallet as never, () => now);
    const cache = emptyRenderCache();
    const run = (refreshReason?: "action" | "ambient" | "event") =>
      hydrateView({
        activeView: "home",
        cache,
        deployment,
        signability,
        multisig: {
          async loadMultisigs() {
            return { intents: [], multisigs: [] };
          },
        },
        paint: () => undefined,
        ...(refreshReason ? { refreshReason } : {}),
        selectedMultisigId: null,
        selectedTokenId: null,
        status,
        wallet,
      } as never);

    // One read per tracked token per fetch (ETH, STRK and, since issue 663,
    // native USDC), plus one deployment-status read per fresh fetch.
    const perFetch = tokens.length;
    await run();
    expect(rpcReads).toBe(perFetch + 1);
    await run("event");
    expect(rpcReads).toBe(perFetch + 1);
    await run("action");
    expect(rpcReads).toBe(2 * (perFetch + 1));
    await run("ambient");
    expect(rpcReads).toBe(2 * (perFetch + 1));
    now = 60_002;
    await run("ambient");
    expect(rpcReads).toBe(3 * (perFetch + 1));
    expect(historyScans).toBe(0);
  });
});
