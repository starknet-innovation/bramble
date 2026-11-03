/**
 * A multisig portfolio fills in rather than flashes an error (issue 795).
 * Before the selected multisig's balances have been read, its home shows the
 * loading shell; only a read that failed shows the failed-load panel, and a
 * saved snapshot still paints at once. A balance answer naming another account
 * is a racing reply: it is dropped, never shown as an error and never shown
 * under this account.
 */
import { describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import {
  emptyRenderCache,
  updateRenderScope,
} from "../../../../src/sidepanel/app/rendering/render-cache";
import { dashboard } from "../../../../src/sidepanel/app/screens/views";
import { hydrateView } from "../../../../src/sidepanel/app/sync/hydrate";
import {
  EMPTY_MULTISIG_PORTFOLIO,
  type MultisigPortfolioData,
} from "../../../../src/sidepanel/journeys/multisig/multisig-portfolio";
import { multisigDetailFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-views";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";

const UNAVAILABLE_PANEL = "Multisig balances are unavailable right now.";
const UNAVAILABLE_HEADER = "Balances are temporarily unavailable.";

const usdcOf = (accountId: string) => ({
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

const multisigHome = async (portfolio?: MultisigPortfolioData): Promise<string> => {
  const fixture = await makeArgentMultisigFixture();
  return multisigDetailFlow(
    fixture.status,
    fixture.status.accounts[0] ?? null,
    fixture.view,
    [],
    false,
    null,
    "multisig-home",
    portfolio,
  );
};

describe("multisig balances not read yet", () => {
  test("the empty render cache and a scope switch read as loading", () => {
    const cache = emptyRenderCache();
    expect(cache.multisigBalances).toEqual({ loading: true });
    expect(EMPTY_MULTISIG_PORTFOLIO.balances).toEqual({ loading: true });
    Object.assign(cache, { multisigBalances: usdcOf("SN_MAIN:0x7aaa") });
    updateRenderScope(cache, { ...cache.status, activeAccountId: "SN_MAIN:0x2" });
    expect(cache.multisigBalances).toEqual({ loading: true });
  });

  test("the multisig home shows the loading shell, not the failed-load panel", async () => {
    const html = await multisigHome();

    expect(html).not.toContain("panel-error");
    expect(html).not.toContain(UNAVAILABLE_PANEL);
    expect(html).toContain('<ul class="token-list" aria-busy="true"></ul>');
    expect(html).toContain(">—</p>");
  });

  test("the header does not call unread multisig balances unavailable", async () => {
    const fixture = await makeArgentMultisigFixture();
    const status: WalletStatus = fixture.status;
    const html = dashboard(
      "multisig-home",
      status,
      [],
      null,
      { balances: [] },
      null,
      [],
      [],
      {},
      [],
      null,
      undefined,
      null,
      {},
      [fixture.view],
      [],
      fixture.record.id,
    );

    expect(html).not.toContain(UNAVAILABLE_HEADER);
    expect(html).not.toContain(UNAVAILABLE_PANEL);
  });

  test("a real failure still shows the failed-load panel", async () => {
    const html = await multisigHome({
      ...EMPTY_MULTISIG_PORTFOLIO,
      balances: { error: "multisig balances unavailable" },
    });

    expect(html).toContain("panel-error");
    expect(html).toContain(UNAVAILABLE_PANEL);
    expect(html).not.toContain('aria-busy="true"');
  });

  test("a saved snapshot paints at once", async () => {
    const html = await multisigHome({
      ...EMPTY_MULTISIG_PORTFOLIO,
      balances: { ...usdcOf("SN_MAIN:0x7aaa"), stale: true },
    });

    expect(html).toContain("USDC");
    expect(html).not.toContain("panel-error");
    expect(html).not.toContain('aria-busy="true"');
  });
});

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

// Hydrates the shared home of `selected`; the live multisig read answers with
// `live`, the cached lane with nothing usable.
const hydrateMultisig = async (
  cache: ReturnType<typeof emptyRenderCache>,
  selected: string,
  live: unknown,
): Promise<void> => {
  let call = 0;
  await hydrateView({
    activeView: "multisig-home",
    cache,
    deployment: {},
    multisig: {
      loadBalances: async () => {
        call += 1;
        return call === 1 ? { error: "no snapshot" } : live;
      },
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

describe("multisig balance hydration", () => {
  test("a failed read with nothing to fall back on replaces loading with the error", async () => {
    const cache = emptyRenderCache();
    await hydrateMultisig(cache, MULTISIG_A, { error: "multisig balances unavailable" });

    expect(cache.multisigBalances as unknown).toEqual({ error: "multisig balances unavailable" });
  });

  test("an answer for another account keeps this account's own snapshot", async () => {
    const cache = emptyRenderCache();
    cache.multisigBalanceId = MULTISIG_A;
    cache.multisigBalances = usdcOf(MULTISIG_A);
    await hydrateMultisig(cache, MULTISIG_A, usdcOf(MULTISIG_B));

    expect(cache.multisigBalances).toEqual(usdcOf(MULTISIG_A));
  });

  test("an answer for another account keeps this account's own error", async () => {
    const cache = emptyRenderCache();
    cache.multisigBalanceId = MULTISIG_A;
    cache.multisigBalances = { error: "multisig balances unavailable" };
    await hydrateMultisig(cache, MULTISIG_A, usdcOf(MULTISIG_B));

    expect(cache.multisigBalances as unknown).toEqual({ error: "multisig balances unavailable" });
  });

  test("an answer for another account, with no own snapshot, stays loading", async () => {
    // The previous account's balances are never relabelled (Sherlock 209), and
    // a racing reply is not a failure either.
    const cache = emptyRenderCache();
    cache.multisigBalanceId = MULTISIG_A;
    cache.multisigBalances = usdcOf(MULTISIG_A);
    await hydrateMultisig(cache, MULTISIG_B, usdcOf(MULTISIG_A));

    expect(cache.multisigBalanceId).toBe(MULTISIG_B);
    expect(cache.multisigBalances as unknown).toEqual({ loading: true });
  });
});
