/**
 * Home experience checks: the account-bar header opens a left drawer wired to
 * real accounts, frequent actions render as rounded-square tools, and the
 * portfolio section switches between Tokens and Collectibles while secondary
 * actions live in one overflow menu.
 */
import { describe, expect, test } from "bun:test";
import type { ArgentMultisigRecord } from "@mc-wallet/multisig/repository";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { account, preferences, secondAccount } from "@mc-wallet/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { dashboard } from "../../../../src/sidepanel/app/screens/views";
import { homeTabs } from "../../../../src/sidepanel/journeys/portfolio/home-tabs";
import { STARKSCAN_URL } from "../../../../src/sidepanel/shell/starkscan-link";
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

  test("header keeps ghost shortcuts for sites, Starkscan, and lock", () => {
    const html = dashboard("home", status, [], preferences, { balances: [] });
    const header = html.slice(html.indexOf("wallet-header"), html.indexOf("hero"));

    expect(header).toContain('data-view="connected-sites"');
    expect(header).toContain('id="starkscan-button"');
    expect(header).toContain('class="icon-button ghost"');
    expect(header).toContain(`href="${STARKSCAN_URL}"`);
    expect(header).toContain('target="_blank" rel="noopener noreferrer"');
    expect(header).toContain('aria-label="Open Starkscan"');
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

    expect(network).toContain('class="account-network-label">Starknet</span>');
    expect(network).not.toContain("Argent Multisig");
  });

  test("quick actions expose Send, Swap, Receive, and the account explorer", () => {
    const html = dashboard("home", status, [], preferences, { balances: [] });

    expect(html).toMatch(/class="action-tile" data-view="send"/);
    expect(html).toMatch(/class="action-tile" data-view="swap"/);
    expect(html).toMatch(/class="action-tile" data-view="receive"/);
    // Explorer is the one outbound tile: the active account on Starkscan, opened
    // in an isolated tab.
    expect(html).toContain(`href="https://starkscan.co/contract/${account.address}"`);
    expect(html).toContain(">Explorer<");
    expect(html).toContain('aria-label="Open this account on the block explorer"');
    expect(html).not.toContain('aria-label="Open MC Terminal portfolio"');
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
    expect(html).not.toContain("Join MC Terminal");
    expect(html).not.toContain("Your homebase for all Starknet activity");
    expect(html).toContain('id="starkscan-button"');
  });

  test("portfolio has two text tabs and one accessible quick-actions menu", () => {
    const html = dashboard("home", status, [], preferences, { balances: [] });

    expect(html).toMatch(/data-home-tab="tokens"[^>]*aria-selected="true"/);
    expect(html).toMatch(/data-home-tab="collectibles"[^>]*aria-selected="false"/);
    expect(html).not.toContain('data-home-tab="activity"');
    expect(html).not.toContain('class="tab-indicator"');
    expect(html).toMatch(/data-tab-panel="tokens"[^>]*>/);
    expect(html).toMatch(/data-tab-panel="collectibles"[^>]*hidden/);
    expect(html).not.toContain('data-tab-panel="activity"');
    const menuTrigger = html.match(/<button[^>]*id="portfolio-menu-trigger"[^>]*>/)?.[0] ?? "";
    expect(menuTrigger).toContain('aria-haspopup="menu"');
    expect(menuTrigger).toContain('aria-expanded="false"');
    expect(html).toContain('id="portfolio-menu" role="menu"');
    expect(html).toContain('data-view="tokens" role="menuitem"');
    expect(html).toContain('data-view="nfts" role="menuitem"');
    expect(html).toContain('data-view="settings" role="menuitem"');
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
      status,
    );

    expect(html).toContain("Manage tokens");
    expect(html).toContain("1 not shown");
    expect(html).not.toContain("Hidden tokens");
  });

  test("collectibles tab reuses watched NFTs and hides spam", () => {
    const withNfts: WalletPreferences = {
      ...preferences,
      nfts: [
        {
          contract: "0xabc",
          id: "SN_MAIN:0xabc:1",
          label: "Starkpunk",
          networkId: "SN_MAIN",
          tokenId: "1",
        },
        {
          contract: "0xdef",
          id: "SN_MAIN:0xdef:2",
          networkId: "SN_MAIN",
          spam: true,
          tokenId: "2",
        },
      ],
    };
    const html = homeTabs({ balances: [] }, withNfts, {}, {}, "usd", status, [
      {
        collection: "",
        contract: "0xabc",
        id: "SN_MAIN:0xabc:1",
        image: "",
        name: "Starkpunk",
        networkId: "SN_MAIN",
        tokenId: "1",
      },
    ]);
    const panel = html.slice(html.indexOf('data-tab-panel="collectibles"'), html.length);

    expect(panel).toContain('data-nft-open="SN_MAIN:0xabc:1"');
    expect(panel).toContain("Starkpunk");
    expect(panel).not.toContain("SN_MAIN:0xdef:2");
    expect(panel).toContain('data-view="nfts"');
  });

  test("collectibles tab joins watched NFTs with resolved artwork metadata", () => {
    const watched: WalletPreferences = {
      ...preferences,
      nfts: [
        {
          contract: "0xabc",
          id: "SN_MAIN:0xabc:0",
          networkId: "SN_MAIN",
          tokenId: "0",
        },
      ],
    };
    const html = homeTabs({ balances: [] }, watched, {}, {}, "usd", status, [
      {
        attributes: [{ traitType: "Catalog", value: "CryptoPunks" }],
        collection: "MC Punks",
        contract: "0xabc",
        id: "SN_MAIN:0xabc:0",
        image: "https://cdn.example/punk0000.png",
        name: "Starknet Test Punk #0",
        networkId: "SN_MAIN",
        tokenId: "0",
      },
    ]);

    expect(html).toContain('class="nft-image nft-image--pixelated"');
    expect(html).toContain('src="https://cdn.example/punk0000.png"');
    expect(html).toContain('loading="eager"');
    expect(html).toContain("Starknet Test Punk #0");
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
    expect(html).not.toContain("Send 1.5 ETH to");
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
    expect(activity).toContain("Send 1.5 ETH to");
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
      null,
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

describe("explorer tile availability", () => {
  test("is disabled rather than hidden when there is nothing to open", () => {
    // No account yet: the row keeps its shape instead of reflowing.
    const noAccounts = dashboard(
      "home",
      { ...status, accounts: [], activeAccountId: null },
      [],
      preferences,
      { balances: [] },
    );
    expect(noAccounts).toContain('aria-label="Explorer unavailable on this network"');
    expect(noAccounts).not.toContain("starkscan.co/contract");

    // Devnet has no public explorer, so an account there gets the same disabled
    // tile rather than a link that cannot resolve.
    const devnet = dashboard(
      "home",
      { ...status, network: "Local Devnet", networkId: "SN_DEVNET" },
      [],
      preferences,
      { balances: [] },
    );
    expect(devnet).toContain('aria-label="Explorer unavailable on this network"');
    expect(devnet).not.toContain("starkscan.co/contract");
  });
});
