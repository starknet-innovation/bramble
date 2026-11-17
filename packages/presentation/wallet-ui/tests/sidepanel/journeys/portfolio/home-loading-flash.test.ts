/**
 * Home fills in rather than flashes (issue 795). Before any balance has been
 * read the screen shows the loading shell, not the failed-load panel; while
 * private discovery is out for an account that can hold private balances,
 * each row reserves its private line and the hero holds "—" until the total is
 * whole. Accounts with privacy off never wait, and a real failure still reads
 * as one.
 */
import { describe, expect, test } from "bun:test";
import type { TokenConfig, WalletPreferences } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import type { TokenBalance, WalletStatus } from "../../../../src/popup/responses/responses";
import {
  emptyRenderCache,
  updateRenderScope,
} from "../../../../src/sidepanel/app/rendering/render-cache";
import { dashboard } from "../../../../src/sidepanel/app/screens/views";
import type { PrivacyDisclosureState } from "../../../../src/sidepanel/journeys/privacy/privacy-model";
import type { BalanceState } from "../../../../src/sidepanel/runtime/runtime";

const eth: TokenConfig = {
  address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  decimals: 18,
  id: "SN_MAIN:ETH:0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  name: "Ether",
  networkId: "SN_MAIN",
  symbol: "ETH",
};
const usdc: TokenConfig = {
  address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
  decimals: 6,
  id: "SN_MAIN:USDC:0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
  name: "USD Coin",
  networkId: "SN_MAIN",
  symbol: "USDC",
};
const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [eth, usdc],
};
const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};
const snapshot: BalanceState = {
  balances: [
    { ...eth, balance: "1250000000000000000", formatted: "1.25" },
    { ...usdc, balance: "10000000", formatted: "10" },
  ] satisfies TokenBalance[],
};
const prices = { [eth.address]: 2_000, [usdc.address]: 1 };

const discovering: PrivacyDisclosureState = { error: null, loading: true, value: null };
// Discovery has not started yet: the auto-load fires on the first bind.
const idle: PrivacyDisclosureState = { error: null, loading: false, value: null };
const discovered: PrivacyDisclosureState = {
  error: null,
  loading: false,
  value: {
    accountId: account.id,
    balances: [
      {
        balance: "0x6f05b59d3b20000",
        formatted: "0.5",
        symbol: "ETH",
        token: eth.address,
        tokenId: eth.id,
      },
    ],
    networkId: "SN_MAIN",
    poolFeeFri: "0x1",
    relayConfigured: true,
    registration: "registered",
  },
};
const blocked = (blockerKind: "ledger" | "network" | "other-wallet"): PrivacyDisclosureState => ({
  blockerKind,
  error: "Private balances unavailable",
  loading: false,
  value: null,
});

const home = (
  balances: BalanceState,
  privacy: PrivacyDisclosureState,
  deployment: boolean | null = true,
): string =>
  dashboard(
    "home",
    status,
    [],
    preferences,
    balances,
    deployment,
    [],
    [],
    prices,
    [],
    null,
    { entries: [], notices: [], unavailable: false },
    null,
    {},
    [],
    [],
    null,
    null,
    [],
    null,
    false,
    null,
    [],
    false,
    null,
    false,
    [],
    false,
    { balances: [] },
    null,
    privacy,
  );

const hero = (html: string): string =>
  html.slice(html.indexOf('class="hero"'), html.indexOf("home-actions"));
const tokens = (html: string): string => html.slice(html.indexOf('class="home-tabs"'));
const summaries = (html: string): string[] =>
  [...tokens(html).matchAll(/<summary[\s\S]*?<\/summary>/g)].map((match) => match[0]);
const count = (html: string, needle: string): number => html.split(needle).length - 1;

describe("no balance snapshot yet", () => {
  test("the empty render cache reads as loading, not as a failed read", () => {
    expect(emptyRenderCache().balances).toEqual({ loading: true });
  });

  test("an account switch clears balances to loading, not to an error", () => {
    const cache = emptyRenderCache();
    Object.assign(cache, {
      balances: { accountId: account.id, balances: [], networkId: "SN_MAIN" },
    });
    updateRenderScope(cache, { ...cache.status, activeAccountId: "SN_MAIN:0x2" });
    expect(cache.balances).toEqual({ loading: true });
  });

  test("first open shows the loading shell without the error panel or header warning", () => {
    const html = home(emptyRenderCache().balances, discovering);

    expect(tokens(html)).not.toContain("panel-error");
    expect(tokens(html)).not.toContain("Retry loading balances");
    expect(html).not.toContain("Balances are temporarily unavailable.");
    expect(html).toContain('<ul class="token-list" aria-busy="true"></ul>');
    expect(hero(html)).toContain(">—</p>");
  });

  test("a real failure still renders the error panel and the header warning", () => {
    const html = home({ error: "balances unavailable" }, discovered);

    expect(tokens(html)).toContain("panel-error");
    expect(tokens(html)).toContain("Retry loading balances");
    expect(html).toContain("Balances are temporarily unavailable.");
    expect(html).not.toContain('aria-busy="true"');
  });

  test("a saved snapshot still renders at once", () => {
    const html = home({ ...snapshot, asOf: 1, stale: true }, discovered);

    expect(hero(html)).toContain("$3,510.00");
    expect(summaries(html)).toHaveLength(2);
    expect(html).not.toContain('aria-busy="true"');
  });
});

describe("private discovery pending", () => {
  for (const [name, privacy] of [
    ["discovering", discovering],
    ["not started", idle],
  ] as const) {
    test(`${name}: every row reserves its private line and the hero holds the total`, () => {
      const html = home(snapshot, privacy);

      expect(hero(html)).toContain('data-total-complete="false"');
      expect(hero(html)).toContain('data-live-value="unknown">—</p>');
      expect(hero(html)).not.toContain("$2,510.00");
      for (const summary of summaries(html)) {
        expect(summary).toContain('<p class="token-split" aria-hidden="true">—</p>');
      }
    });
  }

  test("settling fills the reserved line in place instead of adding one", () => {
    const pending = summaries(home(snapshot, discovering));
    const settled = summaries(home(snapshot, discovered));

    expect(settled).toHaveLength(pending.length);
    // The row holding a private balance keeps its line; it only gains a value.
    expect(count(pending[0] ?? "", "token-split")).toBe(1);
    expect(settled[0]).toContain('<p class="token-split">1.25 public · 0.50 private</p>');
    expect(hero(home(snapshot, discovered))).toContain("$3,510.00");
  });

  test("a failed discovery stops waiting: public total, no reserved line", () => {
    const html = home(snapshot, {
      error: "strk20 services unavailable",
      loading: false,
      value: null,
    });

    expect(hero(html)).toContain("$2,510.00");
    expect(tokens(html)).not.toContain("token-split");
  });
});

describe("privacy off never reserves a private line", () => {
  for (const kind of ["ledger", "network", "other-wallet"] as const) {
    test(`${kind}: the total and rows render without waiting`, () => {
      const html = home(snapshot, blocked(kind));

      expect(hero(html)).toContain("$2,510.00");
      expect(tokens(html)).not.toContain("token-split");
    });
  }

  test("an undeployed account cannot hold private balances, so nothing waits", () => {
    const html = home(snapshot, discovering, false);

    expect(hero(html)).toContain("$2,510.00");
    expect(tokens(html)).not.toContain("token-split");
  });
});
