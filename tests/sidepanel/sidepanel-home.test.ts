/**
 * Home experience checks: the account-bar header opens a left drawer wired to
 * real accounts, quick actions render as tiles, and the portfolio section is
 * tabbed across Tokens, Collectibles, and Activity with the existing data
 * sources behind each panel.
 */
import { describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../src/popup/responses";
import { homeTabs } from "../../src/sidepanel/home-tabs";
import { TERMINAL_URL } from "../../src/sidepanel/terminal-link";
import { dashboard } from "../../src/sidepanel/views";
import type { WalletPreferences } from "../../src/storage/preferences-store";
import { account, preferences, secondAccount } from "../support/sidepanel-fixtures";

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

  test("header keeps ghost shortcuts for sites, terminal, and lock", () => {
    const html = dashboard("home", status, [], preferences, { balances: [] });
    const header = html.slice(html.indexOf("wallet-header"), html.indexOf("hero"));

    expect(header).toContain('data-view="connected-sites"');
    expect(header).toContain(
      `id="terminal-button" class="icon-button ghost" href="${TERMINAL_URL}"`,
    );
    expect(header).toContain('target="_blank" rel="noopener noreferrer"');
    expect(header).toContain('aria-label="Open trade terminal"');
    expect(header).toContain('id="lock-button"');
  });

  test("quick actions render as borderless icon buttons with send carrying the accent", () => {
    // The action row is now just Send / Receive as plain borderless icon buttons
    // (labels beneath, no box treatment). The former third "NFTs" action tile was
    // removed as redundant with the Collectibles home tab (which already reaches
    // the NFT gallery + detail views), leaving a centred two-tile pair. The markup
    // keeps the `action-tile` hook and the `primary` modifier on Send — the box
    // removal lives in the stylesheet — so Send stays distinguishable via its
    // accent-tinted icon.
    const html = dashboard("home", status, [], preferences, { balances: [] });

    expect(html).toMatch(/class="action-tile primary" data-view="send"/);
    expect(html).toMatch(/class="action-tile" data-view="receive"/);
    // The NFTs action tile is gone; NFT access lives on the Collectibles tab.
    expect(html).not.toMatch(/class="action-tile" data-view="nfts"/);

    const noAccounts = dashboard(
      "home",
      { ...status, accounts: [], activeAccountId: null },
      [],
      preferences,
      { balances: [] },
    );
    expect(noAccounts).toMatch(/data-view="send"[^>]*disabled/);
    expect(noAccounts).toMatch(/data-view="receive"[^>]*disabled/);
  });

  test("portfolio section is tabbed with tokens active by default", () => {
    const html = dashboard("home", status, [], preferences, { balances: [] });

    expect(html).toMatch(/data-home-tab="tokens"[^>]*aria-selected="true"/);
    expect(html).toMatch(/data-home-tab="collectibles"[^>]*aria-selected="false"/);
    expect(html).toMatch(/data-home-tab="activity"[^>]*aria-selected="false"/);
    expect(html).toContain('class="tab-indicator"');
    expect(html).toMatch(/data-tab-panel="tokens"[^>]*>/);
    expect(html).toMatch(/data-tab-panel="collectibles"[^>]*hidden/);
    expect(html).toMatch(/data-tab-panel="activity"[^>]*hidden/);
    const tokensActions = html.slice(
      html.indexOf('data-tab-actions="tokens"'),
      html.indexOf('data-tab-actions="collectibles"'),
    );
    expect(tokensActions).toContain('id="refresh-button"');
    expect(tokensActions).toContain('data-view="tokens"');
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
    const html = dashboard("home", status, [], withNfts, { balances: [] });
    const panel = html.slice(
      html.indexOf('data-tab-panel="collectibles"'),
      html.indexOf('data-tab-panel="activity"'),
    );

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
    const html = homeTabs({ balances: [] }, watched, {}, {}, "usd", [], status, false, [
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

  test("activity tab shows recent transactions with a jump to the full log", () => {
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
    const panel = html.slice(
      html.indexOf('data-tab-panel="activity"'),
      html.indexOf("wallet-dock"),
    );

    expect(panel).toContain('class="tx-status accepted"');
    expect(panel).toContain("Send 1.5 ETH to");
    expect(panel).toContain('data-view="activity"');

    const empty = dashboard("home", status, [], preferences, { balances: [] });
    expect(empty).toContain("No activity yet.");
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

  test("stale cached prices surface a last-saved notice on the hero", () => {
    const html = homeWithPrices({ "0x00aa": 5 }, true, 1752501900000);
    const hero = html.slice(html.indexOf('class="hero"'), html.indexOf("action-row"));

    expect(hero).toContain('class="hero-stale"');
    expect(hero).toContain("Showing last saved prices");
    expect(hero).toContain("14 Jul, 14:05 UTC");
    // Cached fiat still renders — the total is not blanked to "—".
    expect(hero).not.toMatch(/class="hero-total">—/);
  });

  test("an unreachable host with no cache shows an explicit unavailable hint", () => {
    const html = homeWithPrices({}, true, null);
    const hero = html.slice(html.indexOf('class="hero"'), html.indexOf("action-row"));

    expect(hero).toContain('class="hero-stale"');
    expect(hero).toContain("Live prices unavailable right now");
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

  test("flow screens carry neither the drawer nor the home tabs", () => {
    const html = dashboard("receive", status, [], preferences, { balances: [] });

    expect(html).not.toContain("drawer-root");
    expect(html).not.toContain("home-tabs");
    expect(html).not.toContain('id="account-trigger"');
  });
});
