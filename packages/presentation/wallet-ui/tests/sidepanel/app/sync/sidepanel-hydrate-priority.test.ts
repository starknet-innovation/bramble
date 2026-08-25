/**
 * Home hydration paints balance/price state before slower history/deployment
 * jobs, and stale hydration generations cannot mutate or repaint the cache.
 */
import { describe, expect, test } from "bun:test";
import { ARGENT_MULTISIG_CONTRACT } from "@mc-wallet/starknet/account-contracts";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { emptyRenderCache } from "../../../../src/sidepanel/app/rendering/render-cache";
import { hydrateView } from "../../../../src/sidepanel/app/sync/hydrate";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";

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

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((next) => {
      resolve = next;
    }),
    resolve,
  };
};

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const emptyMultisigClient = {
  async loadMultisigs() {
    return { intents: [], multisigs: [] };
  },
};

describe("home hydration priority", () => {
  test("paints cached balances and prices before fresh home data", async () => {
    const balances = deferred<Awaited<ReturnType<SidepanelWallet["loadBalances"]>>>();
    const prices = deferred<Awaited<ReturnType<SidepanelWallet["loadPrices"]>>>();
    const activity = deferred<Awaited<ReturnType<SidepanelWallet["loadActivity"]>>>();
    const deployment = deferred<boolean>();
    const nfts = deferred<Awaited<ReturnType<SidepanelWallet["discoverNfts"]>>>();
    const watched = deferred<Awaited<ReturnType<SidepanelWallet["loadWatchedNfts"]>>>();
    const cache = emptyRenderCache();
    const deferredStarts: string[] = [];
    let paints = 0;
    const run = hydrateView({
      activeView: "home",
      cache,
      deployment: {
        load: () => {
          deferredStarts.push("deployment");
          return deployment.promise;
        },
      },
      multisig: emptyMultisigClient,
      paint: () => {
        paints += 1;
      },
      selectedMultisigId: null,
      selectedTokenId: null,
      status,
      wallet: {
        discoverNfts: (
          _includeWatched: boolean,
          _scope?: string,
          _multisigId?: string,
          cached?: boolean,
        ) => {
          if (!cached) deferredStarts.push("nfts");
          return nfts.promise;
        },
        loadWatchedNfts: () => watched.promise,
        loadActivity: (_accountId?: string, cached?: boolean) => {
          if (cached) return Promise.resolve({ entries: [], historyUnavailable: false });
          deferredStarts.push("activity");
          return activity.promise;
        },
        loadBalances: (cached?: boolean) =>
          cached
            ? Promise.resolve({
                accountId: "SN_MAIN:0x1",
                balances: [],
                networkId: "SN_MAIN" as const,
              })
            : balances.promise,
        loadPrices: (cached?: boolean) =>
          cached
            ? Promise.resolve({ asOf: 1, changes: {}, prices: { "0x1": 1 }, stale: true })
            : prices.promise,
      },
    } as never);

    await flush();
    expect(paints).toBe(1);
    expect(cache.prices).toEqual({ "0x1": 1 });
    expect(deferredStarts).toEqual([]);

    balances.resolve({ accountId: "SN_MAIN:0x1", balances: [], networkId: "SN_MAIN" });
    prices.resolve({ asOf: 2, changes: {}, prices: { "0x1": 2 }, stale: false });
    await flush();
    expect(paints).toBe(2);
    expect(cache.prices).toEqual({ "0x1": 2 });
    expect(deferredStarts).toEqual(["deployment", "activity", "nfts"]);

    deployment.resolve(true);
    activity.resolve({ entries: [], historyUnavailable: false });
    nfts.resolve([]);
    watched.resolve([]);
    await run;
    expect(paints).toBeGreaterThanOrEqual(2);
    expect(cache.deployment).toBe(true);
  });

  test("streams watched NFT metadata into the home cache", async () => {
    const cache = emptyRenderCache();
    await hydrateView({
      activeView: "home",
      cache,
      deployment: { load: async () => true },
      multisig: emptyMultisigClient,
      paint: () => undefined,
      selectedMultisigId: null,
      selectedTokenId: null,
      status,
      wallet: {
        discoverNfts: async () => [],
        loadWatchedNfts: async () => [
          {
            collection: "MC Punks",
            contract: "0x123",
            id: "SN_MAIN:0x123:0",
            image: "https://cdn.example/punk.png",
            name: "Punk #0",
            networkId: "SN_MAIN",
            tokenId: "0",
          },
        ],
        loadActivity: async () => ({ entries: [], historyUnavailable: false }),
        loadBalances: async () => ({
          accountId: "SN_MAIN:0x1",
          balances: [],
          networkId: "SN_MAIN",
        }),
        loadPrices: async () => ({ asOf: null, changes: {}, prices: {}, stale: false }),
      },
    } as never);

    expect(cache.discoveredNfts).toHaveLength(1);
  });

  test("paints watched artwork before slow portfolio and indexer jobs finish", async () => {
    const balances = deferred<Awaited<ReturnType<SidepanelWallet["loadBalances"]>>>();
    const prices = deferred<Awaited<ReturnType<SidepanelWallet["loadPrices"]>>>();
    const indexed = deferred<Awaited<ReturnType<SidepanelWallet["discoverNfts"]>>>();
    const watched = deferred<Awaited<ReturnType<SidepanelWallet["loadWatchedNfts"]>>>();
    const cache = emptyRenderCache();
    let paints = 0;
    const run = hydrateView({
      activeView: "home",
      cache,
      deployment: { load: async () => true },
      multisig: emptyMultisigClient,
      paint: () => {
        paints += 1;
      },
      selectedMultisigId: null,
      selectedTokenId: null,
      status,
      wallet: {
        discoverNfts: () => indexed.promise,
        loadActivity: async () => ({ entries: [], historyUnavailable: false }),
        loadBalances: (cached?: boolean) =>
          cached
            ? Promise.resolve({ error: "balance snapshot unavailable" as const })
            : balances.promise,
        loadPrices: (cached?: boolean) =>
          cached
            ? Promise.resolve({ asOf: null, changes: {}, prices: {}, stale: true })
            : prices.promise,
        loadWatchedNfts: () => watched.promise,
      },
    } as never);

    watched.resolve([
      {
        collection: "MC Punks",
        contract: "0x123",
        id: "SN_MAIN:0x123:0",
        image: "https://cdn.example/punk.png",
        name: "Punk #0",
        networkId: "SN_MAIN",
        tokenId: "0",
      },
    ]);
    await flush();
    expect(cache.discoveredNfts).toHaveLength(1);
    expect(paints).toBeGreaterThanOrEqual(2);

    balances.resolve({ accountId: "SN_MAIN:0x1", balances: [], networkId: "SN_MAIN" });
    prices.resolve({ asOf: null, changes: {}, prices: {}, stale: false });
    indexed.resolve([]);
    await run;
  });

  test("drops stale hydration results and paints", async () => {
    const balances = deferred<Awaited<ReturnType<SidepanelWallet["loadBalances"]>>>();
    const cache = emptyRenderCache();
    let current = true;
    let paints = 0;
    const run = hydrateView({
      activeView: "tokens",
      cache,
      deployment: {},
      isCurrent: () => current,
      multisig: emptyMultisigClient,
      paint: () => {
        paints += 1;
      },
      selectedMultisigId: null,
      selectedTokenId: null,
      status,
      wallet: {
        loadBalances: () => balances.promise,
        loadPrices: async () => ({ asOf: null, changes: {}, prices: {}, stale: false }),
      },
    } as never);

    current = false;
    balances.resolve({ accountId: "SN_MAIN:0x1", balances: [], networkId: "SN_MAIN" });
    await run;
    expect(paints).toBe(0);
    expect(cache.balances).toEqual({ error: "wallet locked" });
  });

  test("rejects a balance response scoped to another account", async () => {
    const cache = emptyRenderCache();
    await hydrateView({
      activeView: "tokens",
      cache,
      deployment: {},
      multisig: emptyMultisigClient,
      paint: () => undefined,
      selectedMultisigId: null,
      selectedTokenId: null,
      status,
      wallet: {
        loadBalances: async () => ({
          accountId: "SN_MAIN:0x999",
          balances: [],
          networkId: "SN_MAIN",
        }),
        loadPrices: async () => ({ asOf: null, changes: {}, prices: {}, stale: false }),
      },
    } as never);

    expect(cache.balances).toEqual({ error: "balances unavailable" });
  });

  test("hydrates a multisig home from the shared account balance scope", async () => {
    const multisigId = "SN_MAIN:0x7123";
    const sharedBalances = {
      accountId: multisigId,
      balances: [
        {
          address: "0x3306",
          balance: "125000000",
          decimals: 6,
          formatted: "125",
          id: "SN_MAIN:USDC:0x3306",
          name: "USD Coin",
          networkId: "SN_MAIN" as const,
          symbol: "USDC",
        },
      ],
      networkId: "SN_MAIN" as const,
    };
    const cache = emptyRenderCache();
    let signerBalanceReads = 0;
    const sharedBalanceReads: { cached: boolean; id: string }[] = [];
    const sharedActivityReads: { accountId: string | undefined; cached: boolean }[] = [];
    const sharedNftReads: unknown[][] = [];
    const multisigReads: boolean[] = [];
    const record = {
      accountContractType: "argent-multisig" as const,
      address: "0x7123",
      classHash: ARGENT_MULTISIG_CONTRACT.classHash,
      currentConfig: { signerPublicKeys: ["0x1", "0x2"], threshold: 2 },
      id: multisigId,
      networkId: "SN_MAIN" as const,
    };

    await hydrateView({
      activeView: "multisig-home",
      cache,
      deployment: {},
      multisig: {
        loadBalances: async (id: string, cached = false) => {
          sharedBalanceReads.push({ cached, id });
          return sharedBalances;
        },
        loadMultisigs: async (cached = false) => {
          multisigReads.push(cached);
          return {
            intents: [],
            multisigs: [
              {
                config: {
                  classHash: ARGENT_MULTISIG_CONTRACT.classHash,
                  signerGuids: ["0x1", "0x2"],
                  threshold: 2,
                },
                record,
              },
            ],
          };
        },
      },
      paint: () => undefined,
      selectedMultisigId: multisigId,
      selectedTokenId: null,
      status,
      wallet: {
        discoverNfts: async (...input: readonly unknown[]) => {
          sharedNftReads.push([...input]);
          return [
            {
              collection: "Shared collection",
              contract: "0x456",
              id: "SN_MAIN:0x456:7",
              image: "",
              name: "Shared NFT #7",
              networkId: "SN_MAIN",
              tokenId: "7",
            },
          ];
        },
        loadBalances: async () => {
          signerBalanceReads += 1;
          return { accountId: "SN_MAIN:0x1", balances: [], networkId: "SN_MAIN" };
        },
        loadActivity: async (accountId?: string, cached = false) => {
          sharedActivityReads.push({ accountId, cached });
          return { entries: [], historyUnavailable: false };
        },
        loadPrices: async () => ({ asOf: null, changes: {}, prices: {}, stale: false }),
      },
    } as never);

    expect(sharedBalanceReads).toEqual([
      { cached: true, id: multisigId },
      { cached: false, id: multisigId },
    ]);
    expect(sharedActivityReads).toEqual([
      { accountId: multisigId, cached: true },
      { accountId: multisigId, cached: false },
    ]);
    expect(signerBalanceReads).toBe(0);
    expect(cache.multisigBalanceId).toBe(multisigId);
    expect(cache.multisigBalances).toEqual(sharedBalances);
    expect(sharedNftReads).toEqual([
      [true, `${status.networkId}:${multisigId}`, multisigId, true],
      [true, `${status.networkId}:${multisigId}`, multisigId],
    ]);
    expect(cache.multisigNftId).toBe(multisigId);
    expect(cache.multisigNfts).toHaveLength(1);
    expect(multisigReads).toEqual([true, false]);
  });

  test("paints the cached multisig list then refreshes once without per-account amplification", async () => {
    const cache = emptyRenderCache();
    const reads: boolean[] = [];
    await hydrateView({
      activeView: "multisigs",
      cache,
      deployment: {},
      multisig: {
        loadMultisigs: async (cached = false) => {
          reads.push(cached);
          return { intents: [], multisigs: [] };
        },
      },
      paint: () => undefined,
      selectedMultisigId: null,
      selectedTokenId: null,
      status,
      wallet: {},
    } as never);

    expect(reads).toEqual([true, false]);
    expect(cache.multisigsError).toBe(false);
  });

  test("freshly verifies authority when opening a signing-critical multisig view", async () => {
    const cache = emptyRenderCache();
    const multisigId = "SN_MAIN:0x7123";
    let refreshes = 0;
    await hydrateView({
      activeView: "multisig-detail",
      cache,
      deployment: {},
      multisig: {
        loadMultisigs: async () => ({ intents: [], multisigs: [] }),
        refreshMultisig: async (_id: string, force = false) => {
          refreshes += 1;
          expect(force).toBe(true);
          return {
            intents: [],
            multisig: { authorityStatus: "available", record: { id: multisigId } },
          };
        },
      },
      paint: () => undefined,
      selectedMultisigId: multisigId,
      selectedTokenId: null,
      status,
      wallet: {},
    } as never);

    expect(refreshes).toBe(1);
  });

  test("retains locally confirmed authority when a selected-account refresh is unavailable", async () => {
    const multisigId = "SN_MAIN:0x7123";
    const record = {
      accountContractType: "argent-multisig" as const,
      address: "0x7123",
      classHash: ARGENT_MULTISIG_CONTRACT.classHash,
      currentConfig: { signerPublicKeys: ["0x1"], threshold: 1 },
      id: multisigId,
      networkId: "SN_MAIN" as const,
    };
    const view = {
      authorityStatus: "available" as const,
      config: {
        classHash: ARGENT_MULTISIG_CONTRACT.classHash,
        signerGuids: ["0x1"],
        threshold: 1,
      },
      deployed: true,
      record,
      unsupportedSigners: [],
    };
    const cache = emptyRenderCache();
    cache.multisigsNetworkId = "SN_MAIN";
    cache.multisigs = { intents: [], multisigs: [view] };
    let listReads = 0;
    let selectedReads = 0;

    await hydrateView({
      activeView: "multisig-detail",
      cache,
      deployment: {},
      multisig: {
        loadMultisigs: async () => {
          listReads += 1;
          return { intents: [], multisigs: [view] };
        },
        refreshMultisig: async (id: string, force = false) => {
          selectedReads += 1;
          expect(id).toBe(multisigId);
          expect(force).toBe(true);
          return {
            intents: [],
            multisig: {
              ...view,
              authorityStatus: "network-unavailable" as const,
              config: null,
              deployed: null,
            },
          };
        },
      },
      paint: () => undefined,
      selectedMultisigId: multisigId,
      selectedTokenId: null,
      status,
      wallet: {},
    } as never);

    expect(listReads).toBe(0);
    expect(selectedReads).toBe(1);
    expect(cache.multisigs.multisigs).toEqual([view]);
    expect(cache.multisigsError).toBe(false);
  });
});
