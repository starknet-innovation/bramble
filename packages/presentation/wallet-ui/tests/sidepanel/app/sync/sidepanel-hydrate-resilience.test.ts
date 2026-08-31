/** Cached hydration resilience and ambient multisig refresh invariants. */
import { describe, expect, test } from "bun:test";
import { ARGENT_MULTISIG_CONTRACT } from "@mc-wallet/starknet/account-contracts";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { emptyRenderCache } from "../../../../src/sidepanel/app/rendering/render-cache";
import { hydrateView } from "../../../../src/sidepanel/app/sync/hydrate";

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

describe("cached hydration resilience", () => {
  test("discovers history on Activity entry but not on ambient refresh", async () => {
    const calls: Array<readonly [string | undefined, boolean | undefined, boolean | undefined]> =
      [];
    const run = async (refreshReason: "ambient" | undefined) => {
      const cache = emptyRenderCache();
      cache.multisigsNetworkId = "SN_MAIN";
      await hydrateView({
        activeView: "activity",
        cache,
        deployment: {},
        multisig: {},
        paint: () => undefined,
        ...(refreshReason ? { refreshReason } : {}),
        selectedMultisigId: null,
        selectedTokenId: null,
        status,
        wallet: {
          loadActivity: async (accountId?: string, cached?: boolean, refreshHistory?: boolean) => {
            calls.push([accountId, cached, refreshHistory]);
            return { entries: [], historyUnavailable: false };
          },
        },
      } as never);
    };

    await run(undefined);
    await run("ambient");
    expect(calls).toEqual([
      [undefined, true, undefined],
      [undefined, false, true],
      [undefined, true, undefined],
      [undefined, false, false],
    ]);
  });

  test("skips allowance discovery on ambient ticks and refreshes it on entry", async () => {
    let reads = 0;
    const run = (refreshReason: "ambient" | undefined) =>
      hydrateView({
        activeView: "allowances",
        cache: emptyRenderCache(),
        deployment: {},
        multisig: { loadMultisigs: async () => ({ intents: [], multisigs: [] }) },
        paint: () => undefined,
        ...(refreshReason ? { refreshReason } : {}),
        selectedMultisigId: null,
        selectedTokenId: null,
        status,
        wallet: {
          loadAllowances: async () => {
            reads += 1;
            return [];
          },
        },
      } as never);

    await run("ambient");
    expect(reads).toBe(0);
    await run(undefined);
    expect(reads).toBe(1);
  });

  test("runs live NFT discovery only when entering an NFT surface", async () => {
    const calls: boolean[] = [];
    const run = (activeView: "home" | "nfts", refreshReason?: "ambient") =>
      hydrateView({
        activeView,
        cache: emptyRenderCache(),
        deployment: { load: async () => true },
        multisig: { loadMultisigs: async () => ({ intents: [], multisigs: [] }) },
        paint: () => undefined,
        ...(refreshReason ? { refreshReason } : {}),
        selectedMultisigId: null,
        selectedTokenId: null,
        status,
        wallet: {
          discoverNfts: async (...input: readonly unknown[]) => {
            calls.push(input[3] === true);
            return [];
          },
          loadActivity: async () => ({ entries: [], historyUnavailable: false }),
          loadBalances: async () => ({
            accountId: "SN_MAIN:0x1",
            balances: [],
            networkId: "SN_MAIN",
          }),
          loadPrices: async () => ({ asOf: null, changes: {}, prices: {}, stale: false }),
          loadWatchedNfts: async () => [],
        },
      } as never);

    await run("home");
    await run("nfts", "ambient");
    await run("nfts");
    expect(calls).toEqual([true, true, true, false]);
  });

  test("forces the affected balance lane only for action reconciliation", async () => {
    const calls: Array<readonly [boolean | undefined, boolean | undefined]> = [];
    await hydrateView({
      activeView: "tokens",
      cache: emptyRenderCache(),
      deployment: {},
      multisig: { loadMultisigs: async () => ({ intents: [], multisigs: [] }) },
      paint: () => undefined,
      refreshReason: "action",
      selectedMultisigId: null,
      selectedTokenId: null,
      status,
      wallet: {
        loadBalances: async (cached?: boolean, refresh?: boolean) => {
          calls.push([cached, refresh]);
          return { accountId: "SN_MAIN:0x1", balances: [], networkId: "SN_MAIN" };
        },
        loadPrices: async () => ({ asOf: null, changes: {}, prices: {}, stale: false }),
      },
    } as never);

    expect(calls).toEqual([
      [true, undefined],
      [false, true],
    ]);
  });

  test("keeps a saved balance snapshot when the fresh RPC read fails", async () => {
    const cache = emptyRenderCache();
    await hydrateView({
      activeView: "tokens",
      cache,
      deployment: {},
      multisig: { loadMultisigs: async () => ({ intents: [], multisigs: [] }) },
      paint: () => undefined,
      selectedMultisigId: null,
      selectedTokenId: null,
      status,
      wallet: {
        loadBalances: async (cached?: boolean) =>
          cached
            ? {
                accountId: "SN_MAIN:0x1",
                asOf: 42,
                balances: [],
                networkId: "SN_MAIN",
                stale: false,
              }
            : { error: "RPC unavailable" },
        loadPrices: async () => ({ asOf: null, changes: {}, prices: {}, stale: false }),
      },
    } as never);

    expect(cache.balances).toEqual({
      accountId: "SN_MAIN:0x1",
      asOf: 42,
      balances: [],
      networkId: "SN_MAIN",
      stale: true,
    });
  });

  test("does not re-read confirmed signer authority on ambient multisig home refreshes", async () => {
    const multisigId = "SN_MAIN:0x7123";
    const cache = emptyRenderCache();
    cache.multisigsNetworkId = "SN_MAIN";
    cache.multisigs = {
      intents: [],
      multisigs: [
        {
          authorityStatus: "available",
          config: null,
          deployed: true,
          record: {
            accountContractType: "argent-multisig",
            address: "0x7123",
            classHash: ARGENT_MULTISIG_CONTRACT.classHash,
            currentConfig: { signerPublicKeys: ["0x1"], threshold: 1 },
            id: multisigId,
            networkId: "SN_MAIN",
          },
          unsupportedSigners: [],
        },
      ],
    };
    let refreshes = 0;
    const nftReads: boolean[] = [];

    const run = (refreshReason: "action" | "ambient") =>
      hydrateView({
        activeView: "multisig-home",
        cache,
        deployment: {},
        multisig: {
          loadBalances: async () => ({ error: "offline" }),
          loadMultisigs: async () => cache.multisigs,
          refreshMultisig: async () => {
            refreshes += 1;
            return "error";
          },
        },
        paint: () => undefined,
        refreshReason,
        selectedMultisigId: multisigId,
        selectedTokenId: null,
        status,
        wallet: {
          discoverNfts: async (...input: readonly unknown[]) => {
            nftReads.push(input[3] === true);
            return [];
          },
          loadActivity: async () => ({ entries: [], historyUnavailable: false }),
          loadPrices: async () => ({ asOf: null, changes: {}, prices: {}, stale: false }),
        },
      } as never);

    await run("ambient");
    expect(refreshes).toBe(0);
    expect(nftReads).toEqual([true]);
    await run("action");
    expect(refreshes).toBe(1);
  });
});
