/**
 * A failed shared-account balance read never relabels another account's
 * balances as the selected one's (Sherlock 209). Only the selected account's
 * own last balances may be kept, marked stale.
 */
import { describe, expect, test } from "bun:test";
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

const MULTISIG_A = "SN_MAIN:0x7aaa";
const MULTISIG_B = "SN_MAIN:0x7bbb";

const balancesOf = (accountId: string) => ({
  accountId,
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
});

const unavailable = { error: "multisig balances unavailable" };

// Hydrates the shared home of `selected` with a balance reader that fails on
// both the cached and the live lane.
const hydrateFailing = async (
  cache: ReturnType<typeof emptyRenderCache>,
  selected: string,
): Promise<void> => {
  await hydrateView({
    activeView: "multisig-home",
    cache,
    deployment: {},
    multisig: {
      loadBalances: async () => unavailable,
      loadMultisigs: async () => ({ intents: [], multisigs: [] }),
    },
    paint: () => undefined,
    selectedMultisigId: selected,
    selectedTokenId: null,
    status,
    wallet: {
      loadActivity: async () => ({ entries: [], historyUnavailable: false }),
      loadBalances: async () => ({ accountId: "SN_MAIN:0x1", balances: [], networkId: "SN_MAIN" }),
      loadPrices: async () => ({ asOf: null, changes: {}, prices: {}, stale: false }),
    },
  } as never);
};

describe("shared-account balances after a failed read", () => {
  test("never show the previous account's balances under a newly selected account", async () => {
    const cache = emptyRenderCache();
    cache.multisigBalanceId = MULTISIG_A;
    cache.multisigBalances = balancesOf(MULTISIG_A);

    await hydrateFailing(cache, MULTISIG_B);

    expect(cache.multisigBalanceId).toBe(MULTISIG_B);
    expect(cache.multisigBalances).toEqual(unavailable);
  });

  test("keep the selected account's own last balances, marked stale", async () => {
    const cache = emptyRenderCache();
    cache.multisigBalanceId = MULTISIG_A;
    cache.multisigBalances = balancesOf(MULTISIG_A);

    await hydrateFailing(cache, MULTISIG_A);

    expect(cache.multisigBalances).toEqual({ ...balancesOf(MULTISIG_A), stale: true });
  });

  test("never keep balances whose payload names another account, even under this id", async () => {
    const cache = emptyRenderCache();
    cache.multisigBalanceId = MULTISIG_B;
    cache.multisigBalances = balancesOf(MULTISIG_A);

    await hydrateFailing(cache, MULTISIG_B);

    expect(cache.multisigBalances).toEqual(unavailable);
  });
});
