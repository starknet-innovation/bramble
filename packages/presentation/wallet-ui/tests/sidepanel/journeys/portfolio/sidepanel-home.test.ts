/**
 * Home experience checks: the account-bar header opens a left drawer wired to
 * real accounts, frequent actions render as rounded-square tools, and the
 * portfolio section shows only the Tokens tab (Collectibles is parked) while
 * secondary actions live in one overflow menu.
 */
import { describe, expect, test } from "bun:test";
import type { ArgentMultisigRecord } from "@bramble/multisig/repository";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { account, preferences, secondAccount } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { dashboard } from "../../../../src/sidepanel/app/screens/views";
import { homeTabs } from "../../../../src/sidepanel/journeys/portfolio/home-tabs";
import { homeScreen } from "../../../../src/sidepanel/journeys/portfolio/home-view";
import { walletHeader } from "../../../../src/sidepanel/shell/wallet-shell";

const status: WalletStatus = {
  accountCount: 2,
  accounts: [account, secondAccount],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [
    { id: "SN_MAIN", name: "Starknet Mainnet" },
    { id: "SN_SEPOLIA", name: "Starknet Sepolia" },
  ],
  ready: true,
};

describe("sidepanel home", () => {
  test("header exposes an avatar trigger that owns the account drawer", () => {
    const html = dashboard("home", status, [], preferences, { balances: [] });

    expect(html).toContain('id="account-trigger"');
    expect(html).toMatch(/id="account-trigger"[^>]*aria-haspopup="dialog"/);
    expect(html).toMatch(/class="drawer-root" data-open="false"/);
    expect(html).toMatch(new RegExp(`data-switch-account="${account.id}"[^>]*aria-pressed="true"`));
    expect(html).toMatch(
      new RegExp(`data-switch-account="${secondAccount.id}"[^>]*aria-pressed="false"`),
    );
    expect(html).toContain('id="drawer-add-account"');
    const drawer = html.slice(html.indexOf("drawer-root"));
    expect(drawer).toContain('data-view="account"');
    expect(drawer).toContain("data-drawer-close");
  });

  test("header opens the account it is showing on the explorer", () => {
    const html = dashboard("home", status, [], preferences, { balances: [] });
    const header = html.slice(html.indexOf("wallet-header"), html.indexOf("hero"));

    expect(header).toContain('data-view="connected-sites"');
    expect(header).toContain('id="starkscan-button"');
    expect(header).toContain('class="icon-button ghost"');
    // The account's own page, not the explorer front page: Home no longer carries
    // an explorer tile, so this is the only account-level explorer route left.
    expect(header).toContain(`href="https://starkscan.co/contract/${account.address}"`);
    expect(header).toContain('target="_blank" rel="noopener noreferrer"');
    expect(header).toContain('aria-label="View this account on the block explorer"');
    expect(header).toContain('id="lock-button"');
  });

  test("header keeps network identity single-purpose for shared accounts", () => {
    const multisig: ArgentMultisigRecord = {
      accountContractType: "argent-multisig",
      address: "0x999",
      classHash: "0x123",
      id: "SN_MAIN:0x999",
      name: "Treasury",
      networkId: "SN_MAIN",
    };
    const html = walletHeader(status, account, preferences, multisig);
    const network = html.slice(html.indexOf('class="account-net'), html.indexOf("</header>"));

    expect(network).toContain('class="account-network-label">Mainnet</span>');
    expect(network).not.toContain("Argent Multisig");
  });

  test("quick actions expose Send, Swap, Receive, and Shield", () => {
    const html = dashboard("home", status, [], preferences, { balances: [] });

    expect(html).toMatch(/class="action-tile" data-view="send"/);
    expect(html).toMatch(/class="action-tile" data-view="swap"/);
    expect(html).toMatch(/class="action-tile" data-view="receive"/);
    // Shield holds the fourth slot the explorer tile used to. This fixture tracks
    // no tokens, so it renders in its disabled state; the shield tile suite below
    // covers what each privacy state renders.
    expect(html).toContain(">Shield<");
    expect(html).not.toContain(">Explorer<");
    expect(html).not.toContain('aria-label="Open Bramble Terminal portfolio"');
    expect(html).not.toMatch(/class="action-tile" data-view="nfts"/);

    const noAccounts = dashboard(
      "home",
      { ...status, accounts: [], activeAccountId: null },
      [],
      preferences,
      { balances: [] },
    );
    expect(noAccounts).toMatch(/data-view="send"[^>]*disabled/);
    expect(noAccounts).toMatch(/data-view="swap"[^>]*disabled/);
    expect(noAccounts).toMatch(/data-view="receive"[^>]*disabled/);
  });

  test("home promotes no Terminal card and keeps the Starkscan shortcut", () => {
    const html = dashboard("home", status, [], preferences, { balances: [] });

    expect(html).not.toContain("terminal-cta");
    expect(html).not.toContain("Join Bramble Terminal");
    expect(html).not.toContain("Your homebase for all Starknet activity");
    expect(html).toContain('id="starkscan-button"');
  });

  test("portfolio has a Tokens heading, no tablist, and one accessible quick-actions menu", () => {
    const html = dashboard("home", status, [], preferences, { balances: [] });

    const portfolio = html.slice(
      html.indexOf('<section class="home-tabs"'),
      html.indexOf("</main>"),
    );
    expect(portfolio).toContain("<h2>Tokens</h2>");
    // The wallet dock is the only tablist left; the portfolio section is a heading
    // with no tab, panel, or indicator scaffolding behind it.
    expect(portfolio).not.toContain('role="tab');
    expect(portfolio).not.toContain("data-home-tab=");
    expect(portfolio).not.toContain("tab-panel");
    expect(html).not.toContain("Collectibles");
    expect(html).not.toContain('class="tab-indicator"');
    const menuTrigger = html.match(/<button[^>]*id="portfolio-menu-trigger"[^>]*>/)?.[0] ?? "";
    expect(menuTrigger).toContain('aria-haspopup="menu"');
    expect(menuTrigger).toContain('aria-expanded="false"');
    expect(html).toContain('id="portfolio-menu" role="menu"');
    expect(html).toContain('data-view="tokens" role="menuitem"');
    expect(html).not.toContain('data-view="nfts"');
    // Settings has its own dock button, so the menu does not repeat it.
    expect(html).not.toContain('data-view="settings" role="menuitem"');
    expect(html).toContain('id="refresh-button" role="menuitem"');
  });

  test("home names filtered balances by their action, not as user-hidden tokens", () => {
    const token = {
      address: "0x123",
      decimals: 18,
      id: "SN_MAIN:FILTERED:0x123",
      name: "Filtered token",
      networkId: "SN_MAIN" as const,
      symbol: "FILTERED",
    };
    const html = homeTabs(
      { balances: [{ ...token, balance: "1", formatted: "0.000000000000000001" }] },
      { ...preferences, hiddenTokens: [token.id], tokens: [token] },
      {},
      {},
      "usd",
    );

    expect(html).toContain("Manage tokens");
    expect(html).toContain("1 not shown");
    expect(html).not.toContain("Hidden tokens");
    // Every balance is hidden, so the panel has no list for the row to follow.
    expect(html).not.toContain('class="token-list"');
    expect(html).toContain('<button class="menu-row" data-view="tokens"');
  });

  test("Activity stays a top-level dock destination instead of a portfolio tab", () => {
    const html = dashboard("home", status, [], preferences, { balances: [] }, null, [
      {
        accountId: account.id,
        hash: "0x7abc1234567890abcdef",
        kind: "transfer",
        networkId: "SN_MAIN",
        status: "accepted",
        submittedAt: 1000,
        summary: "Send 1.5 ETH to 0x777a…bbcc",
      },
    ]);
    expect(html).not.toContain('data-home-tab="activity"');
    expect(html).not.toContain("Sent 1.5 ETH");
    expect(html).toMatch(/class="nav-item" data-view="activity"/);

    const activity = dashboard("activity", status, [], preferences, { balances: [] }, null, [
      {
        accountId: account.id,
        hash: "0x7abc1234567890abcdef",
        kind: "transfer",
        networkId: "SN_MAIN",
        status: "accepted",
        submittedAt: 1000,
        summary: "Send 1.5 ETH to 0x777a…bbcc",
      },
    ]);
    expect(activity).toContain("Sent 1.5 ETH");
  });

  // Positional args after expandedGroupId(20): priceStale(21), priceAsOf(22).
  // The leading args mirror the other home tests; only the trailing pair varies.
  const homeWithPrices = (
    prices: Readonly<Record<string, number>>,
    priceStale: boolean,
    priceAsOf: number | null,
  ): string =>
    dashboard(
      "home",
      status,
      [],
      preferences,
      { balances: [] },
      null,
      [],
      [],
      prices,
      [],
      null,
      [],
      null,
      {},
      [],
      [],
      null,
      null,
      [],
      null,
      priceStale,
      priceAsOf,
    );

  test("stale cached prices remain visible with their detail in the network status", () => {
    const html = homeWithPrices({ "0x00aa": 5 }, true, 1752501900000);
    const hero = html.slice(html.indexOf('class="hero"'), html.indexOf("action-row"));

    expect(hero).not.toContain("Using saved prices");
    expect(html).toContain('class="account-net degraded"');
    expect(html).toContain("Using saved prices (14 Jul, 14:05 UTC).");
    // Cached fiat still renders — the total is not blanked to "—".
    expect(hero).not.toMatch(/class="hero-total">—/);
  });

  test("an unreachable host with no cache explains the degraded network status", () => {
    const html = homeWithPrices({}, true, null);
    const hero = html.slice(html.indexOf('class="hero"'), html.indexOf("action-row"));

    expect(hero).not.toContain("Live prices");
    expect(html).toContain("Live prices are temporarily unavailable.");
    // No prices to convert: the total degrades to the em dash, as before.
    expect(hero).toContain('class="hero-total"');
    expect(hero).toContain('data-live-value="unknown">—');
  });

  test("fresh prices render no stale notice", () => {
    const html = homeWithPrices({ "0x00aa": 5 }, false, 1752501900000);
    const hero = html.slice(html.indexOf('class="hero"'), html.indexOf("action-row"));

    expect(hero).not.toContain("hero-stale");
    expect(hero).not.toContain("last saved");
  });

  test("saved balances survive a failed refresh with detail in the network status", () => {
    const html = dashboard(
      "home",
      status,
      [],
      preferences,
      { asOf: 1752501900000, balances: [], stale: true },
      null,
      [],
      [],
      {},
    );
    expect(html).not.toMatch(/class="hero[^>]*>[\s\S]*Using saved balances/);
    expect(html).toContain('class="account-net degraded"');
    expect(html).toContain("Using saved balances (14 Jul, 14:05 UTC).");
  });

  test("flow screens carry neither the drawer nor the home tabs", () => {
    const html = dashboard("receive", status, [], preferences, { balances: [] });

    expect(html).not.toContain("drawer-root");
    expect(html).not.toContain("home-tabs");
    expect(html).not.toContain('id="account-trigger"');
  });
});

describe("shield tile", () => {
  const homeArgs = (
    privacy: Parameters<typeof homeScreen>[9],
    prefs: WalletPreferences | null = defaultWalletPreferences(),
  ): string =>
    homeScreen(status, account, { balances: [] }, 0, null, prefs, {}, {}, "usd", privacy);

  const disclosure = (
    registration: "pending" | "registered" | "unregistered",
  ): Parameters<typeof homeScreen>[9] => ({
    error: null,
    loading: false,
    value: {
      accountId: account.id,
      balances: [],
      networkId: status.networkId,
      poolFeeFri: "0x1",
      registration,
      relayConfigured: true,
    },
  });

  test("opens the shield send flow once the pool registration is live", () => {
    const html = homeArgs(disclosure("registered"));

    // The same attribute the token-detail Shield uses, so the one existing
    // binding drives both and they cannot drift into different flows.
    expect(html).toMatch(/class="action-tile" data-send-shield="SN_MAIN:STRK:[^"]+"/);
    expect(html).toContain('aria-label="Shield public value into your private balance"');
    expect(html).toContain(">Shield<");
  });

  test("routes to activation instead of a dead control before registering", () => {
    for (const registration of ["unregistered", "pending"] as const) {
      const html = homeArgs(disclosure(registration));

      expect(html).toMatch(/class="action-tile" data-privacy-open="SN_MAIN:STRK:[^"]+"/);
      expect(html).toContain('aria-label="Activate private balances"');
      expect(html).not.toContain("data-send-shield");
    }
  });

  test("is disabled rather than hidden when no token is tracked", () => {
    // Keeps the row at four tiles instead of reflowing, the same reason the
    // explorer tile it replaced was disabled rather than dropped.
    const html = homeArgs(disclosure("registered"), preferences);

    expect(html).toContain('aria-label="Shield unavailable until a token is tracked"');
    expect(html).toMatch(/class="action-tile" type="button" disabled/);
    expect(html).not.toContain("data-send-shield");
    expect(html).not.toContain("data-privacy-open");
  });

  test("no longer offers an explorer tile, which the header now owns", () => {
    const html = homeArgs(disclosure("registered"));

    expect(html).not.toContain(">Explorer<");
    expect(html).not.toContain("starkscan.co/contract");
  });
});

describe("home read-only flag", () => {
  const idlePrivacy: Parameters<typeof homeScreen>[9] = {
    error: null,
    loading: false,
    value: null,
  };
  const render = (signability: Parameters<typeof homeScreen>[10]) =>
    homeScreen(
      status,
      account,
      { balances: [] },
      0,
      true,
      defaultWalletPreferences(),
      {},
      {},
      "usd",
      idlePrivacy,
      signability,
    );

  test("says Read only under the total and greys the signing actions", () => {
    const markup = render({ readOnly: true, reason: "braavos" });
    expect(markup).toContain('data-read-only="true"');
    expect(markup).toContain("Read only");
    const tile = (id: string): string => {
      const start = markup.indexOf(`data-view="${id}"`);
      expect(start).toBeGreaterThan(-1);
      const open = markup.lastIndexOf("<button", start);
      return markup.slice(open, markup.indexOf(">", start) + 1);
    };
    expect(tile("send")).toContain("disabled");
    expect(tile("swap")).toContain("disabled");
    // Receiving needs no signature; it stays live.
    expect(tile("receive")).not.toContain("disabled");
    // Shield must be a true disabled control, not a link into a signing flow
    // (the privacy activation a read-only account cannot complete).
    const shield = markup.slice(
      markup.indexOf("Shield unavailable") - 120,
      markup.indexOf("Shield unavailable"),
    );
    expect(markup).toContain("Shield unavailable — this account is read only");
    expect(shield).toContain("disabled");
    expect(markup).not.toContain('data-privacy-open="SN_MAIN:STRK');
  });

  test("renders a normal account when signable or unknown", () => {
    for (const signability of [{ readOnly: false as const }, null]) {
      const markup = render(signability);
      expect(markup).not.toContain('data-read-only="true"');
      expect(markup).not.toContain("Read only");
    }
  });
});
