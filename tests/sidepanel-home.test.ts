/**
 * Home experience checks: the account-bar header opens a left drawer wired to
 * real accounts, quick actions render as tiles, and the portfolio section is
 * tabbed across Tokens, Collectibles, and Activity with the existing data
 * sources behind each panel.
 */
import { describe, expect, test } from "bun:test";
import type { WalletStatus } from "../src/popup/responses";
import { dashboard } from "../src/sidepanel/views";
import type { WalletPreferences } from "../src/storage/preferences-store";
import type { AccountRef } from "../src/storage/vault-schema";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
};

const secondAccount: AccountRef = {
  ...account,
  address: "0x9994567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  id: "SN_MAIN:0x9994567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
};

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

const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [],
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

  test("header keeps ghost shortcuts for connected sites and lock", () => {
    const html = dashboard("home", status, [], preferences, { balances: [] });
    const header = html.slice(html.indexOf("wallet-header"), html.indexOf("hero"));

    expect(header).toContain('data-view="connected-sites"');
    expect(header).toContain('id="lock-button"');
  });

  test("quick actions render as rounded tiles with send carrying the accent", () => {
    const html = dashboard("home", status, [], preferences, { balances: [] });

    expect(html).toMatch(/class="action-tile primary" data-view="send"/);
    expect(html).toMatch(/class="action-tile" data-view="receive"/);
    expect(html).toMatch(/class="action-tile" data-view="nfts"/);

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

  test("flow screens carry neither the drawer nor the home tabs", () => {
    const html = dashboard("receive", status, [], preferences, { balances: [] });

    expect(html).not.toContain("drawer-root");
    expect(html).not.toContain("home-tabs");
    expect(html).not.toContain('id="account-trigger"');
  });
});
