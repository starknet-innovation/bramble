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

    await hydrateView({
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
      selectedMultisigId: multisigId,
      selectedTokenId: null,
      status,
      wallet: {
        discoverNfts: async () => [],
        loadActivity: async () => ({ entries: [], historyUnavailable: false }),
        loadPrices: async () => ({ asOf: null, changes: {}, prices: {}, stale: false }),
      },
    } as never);

    expect(refreshes).toBe(0);
  });
});
