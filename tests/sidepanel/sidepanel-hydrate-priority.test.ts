/**
 * Home hydration paints balance/price state before slower history/deployment
 * jobs, and stale hydration generations cannot mutate or repaint the cache.
 */
import { describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../src/popup/responses";
import { hydrateView } from "../../src/sidepanel/hydrate";
import { emptyRenderCache } from "../../src/sidepanel/render-cache";
import type { SidepanelWallet } from "../../src/sidepanel/runtime";

const status: WalletStatus = {
  accountCount: 1,
  accounts: [],
  activeAccountId: null,
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

describe("home hydration priority", () => {
  test("paints critical balances and prices before deferred home data", async () => {
    const balances = deferred<Awaited<ReturnType<SidepanelWallet["loadBalances"]>>>();
    const prices = deferred<Awaited<ReturnType<SidepanelWallet["loadPrices"]>>>();
    const activity = deferred<Awaited<ReturnType<SidepanelWallet["loadActivity"]>>>();
    const deployment = deferred<boolean>();
    const nfts = deferred<Awaited<ReturnType<SidepanelWallet["discoverNfts"]>>>();
    const cache = emptyRenderCache();
    let paints = 0;
    const run = hydrateView({
      activeView: "home",
      cache,
      deployment: { load: () => deployment.promise },
      multisig: {},
      paint: () => {
        paints += 1;
      },
      selectedMultisigId: null,
      selectedTokenId: null,
      status,
      wallet: {
        discoverNfts: () => nfts.promise,
        loadActivity: () => activity.promise,
        loadBalances: () => balances.promise,
        loadPrices: () => prices.promise,
      },
    } as never);

    balances.resolve({ balances: [] });
    prices.resolve({ asOf: 1, changes: {}, prices: { "0x1": 1 }, stale: false });
    await flush();
    expect(paints).toBe(1);
    expect(cache.prices).toEqual({ "0x1": 1 });

    deployment.resolve(true);
    activity.resolve({ entries: [], historyUnavailable: false });
    nfts.resolve([]);
    await run;
    expect(paints).toBe(2);
    expect(cache.deployment).toBe(true);
  });

  test("streams discovered NFT metadata into the home cache", async () => {
    const cache = emptyRenderCache();
    await hydrateView({
      activeView: "home",
      cache,
      deployment: { load: async () => true },
      multisig: {},
      paint: () => undefined,
      selectedMultisigId: null,
      selectedTokenId: null,
      status,
      wallet: {
        discoverNfts: async () => [
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
        loadBalances: async () => ({ balances: [] }),
        loadPrices: async () => ({ asOf: null, changes: {}, prices: {}, stale: false }),
      },
    } as never);

    expect(cache.discoveredNfts).toHaveLength(1);
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
      multisig: {},
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
    balances.resolve({ balances: [] });
    await run;
    expect(paints).toBe(0);
    expect(cache.balances).toEqual({ error: "wallet locked" });
  });
});
