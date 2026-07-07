/**
 * Side panel template checks: dock screens share the shell, flow screens are
 * dedicated goal journeys with back navigation, and wallet flows stay
 * separated.
 */
import { describe, expect, test } from "bun:test";
import type { WalletStatus } from "../src/popup/responses";
import { dashboard, WALLET_VIEWS } from "../src/sidepanel/views";
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

const dockSlice = (html: string): string => html.slice(html.indexOf("wallet-dock"));

describe("sidepanel views", () => {
  test("dock screens carry a bottom dock with home, activity, and settings only", () => {
    const html = dashboard("home", status, [], preferences, { balances: [] });
    const dock = dockSlice(html);

    expect(WALLET_VIEWS).toContain("receive");
    expect(html).toContain('class="wallet-dock"');
    expect(html).toContain('role="tablist"');
    expect(dock).toContain('data-view="home"');
    expect(dock).toContain('data-view="activity"');
    expect(dock).toContain('data-view="settings"');
    expect(dock).not.toContain('data-view="send"');
    expect(dock).not.toContain('data-view="receive"');
    expect(html).toContain('aria-controls="wallet-screen-home"');
    expect(html).toContain('aria-selected="true"');
  });

  test("home keeps send and receive as quick actions, not settings or activity", () => {
    const html = dashboard("home", status, [], preferences, { balances: [] });
    const hero = html.slice(html.indexOf("hero"), html.indexOf("wallet-dock"));

    expect(hero).toContain('data-view="send"');
    expect(hero).toContain('data-view="receive"');
    expect(hero).not.toContain('data-view="settings"');
    expect(html).not.toContain('id="wallet-screen-receive"');
    // Home shows the truncated address and offers copy; the full address is
    // only a copy affordance (data-copy), never rendered as visible text.
    expect(html).not.toContain(`<code>${account.address}`);
    expect(html).toContain(`data-copy="${account.address}"`);
  });

  test("receive is a dedicated flow screen with back navigation and no dock", () => {
    const html = dashboard("receive", status, [], preferences, { balances: [] });

    expect(html).toContain('id="wallet-screen-receive"');
    expect(html).toContain(account.address);
    expect(html).toMatch(/data-view="home"[^>]*aria-label="Back"/);
    expect(html).not.toContain("wallet-dock");
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('id="lock-button"');
  });

  test("settings is a menu of dedicated flows instead of inline controls", () => {
    const html = dashboard("settings", status, [], preferences, { balances: [] });

    expect(html).toMatch(/menu-row" data-view="network"[\s\S]*?Network/);
    expect(html).toContain('data-view="account"');
    expect(html).toContain('data-view="address-book"');
    expect(html).toContain('data-view="backup"');
    expect(html).not.toContain('id="active-network"');
    expect(html).not.toContain('id="active-account"');
    expect(html).toContain('data-theme-id="dark"');
    expect(html).toContain('id="currency-select"');
    expect(html).toContain('class="wallet-dock"');
  });

  test("network flow lists networks, marks the active one, and returns to settings", () => {
    const html = dashboard("network", status, [], preferences, { balances: [] });

    expect(html).toMatch(/data-network-id="SN_MAIN"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/data-network-id="SN_SEPOLIA"[^>]*aria-pressed="false"/);
    expect(html).toMatch(/data-view="settings"[^>]*aria-label="Back"/);
    expect(html).not.toContain("wallet-dock");
  });

  test("account flow lists network accounts and shows active identifiers", () => {
    const html = dashboard("account", status, [], preferences, { balances: [] });

    expect(html).toMatch(new RegExp(`data-account-id="${account.id}"[^>]*aria-pressed="true"`));
    expect(html).toMatch(
      new RegExp(`data-account-id="${secondAccount.id}"[^>]*aria-pressed="false"`),
    );
    expect(html).toContain(account.classHash);
    expect(html).toMatch(/data-view="settings"[^>]*aria-label="Back"/);
    expect(html).not.toContain("wallet-dock");
  });

  test("surfaces pending connection requests as a badge and a home callout", () => {
    const pending = [
      { id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14", origin: "https://dapp.example" },
    ];
    const home = dashboard("home", status, pending, preferences, { balances: [] });
    const quiet = dashboard("home", status, [], preferences, { balances: [] });

    expect(home).toContain('class="badge"');
    expect(home).toContain("connection request waiting");
    expect(home).toMatch(/callout[^>]*>[\s\S]*data-view="activity"/);
    expect(quiet).not.toContain('class="badge"');
    expect(quiet).not.toContain("connection request waiting");
  });

  test("lets the activity screen approve or deny each request by id", () => {
    const pending = [
      { id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14", origin: "https://dapp.example" },
    ];
    const html = dashboard("activity", status, pending, preferences, { balances: [] });

    expect(html).toContain("https://dapp.example");
    expect(html).toContain('data-approval-action="approve"');
    expect(html).toContain('data-approval-action="deny"');
    expect(html).toContain(`data-approval-id="${pending[0]?.id}"`);
  });

  test("explains why sending is unavailable instead of failing silently", () => {
    const html = dashboard("send", status, [], preferences, { balances: [] });

    expect(html).toContain("No tokens are tracked on this network yet");
    expect(html).toMatch(/<button type="submit" disabled>/);
  });

  test("shows a clickable deploy chip only when the account is not deployed", () => {
    const undeployed = dashboard("home", status, [], preferences, { balances: [] }, false);
    const deployed = dashboard("home", status, [], preferences, { balances: [] }, true);
    const unknown = dashboard("home", status, [], preferences, { balances: [] }, null);

    expect(undeployed).toContain('id="deploy-button"');
    expect(undeployed).toContain("Not deployed");
    expect(deployed).not.toContain('id="deploy-button"');
    expect(unknown).not.toContain('id="deploy-button"');
  });

  test("send flow reviews before it sends, with fee speed control", () => {
    const html = dashboard("send", status, [], preferences, { balances: [] });

    expect(html).toContain('id="review-panel"');
    expect(html).toContain('name="speed"');
    expect(html).toContain("Review send");
  });

  test("activity lists recorded transactions with status and export controls", () => {
    const html = dashboard("activity", status, [], preferences, { balances: [] }, null, [
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

    expect(html).toContain('class="tx-status accepted"');
    expect(html).toContain("Send 1.5 ETH to");
    expect(html).toContain('id="activity-export"');
    expect(html).toContain('id="activity-refresh"');

    const empty = dashboard("activity", status, [], preferences, { balances: [] });
    expect(empty).toContain("Transactions you submit from this wallet appear here.");
  });

  test("shows account labels and identicons across header and account flow", () => {
    const labeled = {
      ...preferences,
      accountLabels: { [account.id]: "Savings" },
    };
    const home = dashboard("home", status, [], labeled, { balances: [] });
    expect(home).toContain("Savings");
    expect(home).toContain('class="avatar"');

    const accountFlowHtml = dashboard("account", status, [], labeled, { balances: [] });
    expect(accountFlowHtml).toContain('id="label-form"');
    expect(accountFlowHtml).toContain('value="Savings"');
    expect(accountFlowHtml).toContain('class="option-avatar"');
  });

  test("backup flow exports and restores non-secret data with back navigation", () => {
    const html = dashboard("backup", status, [], preferences, { balances: [] });

    expect(html).toContain('id="backup-export"');
    expect(html).toContain('id="backup-import"');
    expect(html).toContain('id="backup-file"');
    expect(html).toMatch(/data-view="settings"[^>]*aria-label="Back"/);
    expect(html).not.toContain('class="wallet-dock"');
  });

  test("account flow offers adding a derived account", () => {
    const html = dashboard("account", status, [], preferences, { balances: [] });

    expect(html).toContain('id="new-account"');
    expect(html).toContain("Add account");
  });

  test("settings links to the reveal-secrets flow", () => {
    expect(WALLET_VIEWS).toContain("reveal");
    const html = dashboard("settings", status, [], preferences, { balances: [] });

    expect(html).toContain('data-view="reveal"');
    expect(html).toContain("Reveal secrets");
  });

  test("reveal flow re-authenticates and masks secrets until tapped", () => {
    const html = dashboard("reveal", status, [], preferences, { balances: [] });

    expect(html).toContain('id="wallet-screen-reveal"');
    expect(html).toContain('id="reveal-form"');
    expect(html).toContain('name="vaultPassphrase"');
    expect(html).toContain('id="reveal-phrase"');
    expect(html).toContain("is-masked");
    expect(html).toMatch(/data-view="settings"[^>]*aria-label="Back"/);
    expect(html).not.toContain("wallet-dock");
  });

  test("contacts can be removed from the address book flow", () => {
    const withContact = {
      ...preferences,
      addressBook: [
        { address: "0x123", id: "SN_MAIN:0x123", label: "Ada", networkId: "SN_MAIN" as const },
      ],
    };
    const html = dashboard("address-book", status, [], withContact, { balances: [] });
    expect(html).toContain('data-remove-address="SN_MAIN:0x123"');
  });

  test("renders balances as labelled token rows with a refresh control", () => {
    const html = dashboard("home", status, [], preferences, {
      balances: [
        {
          address: account.address,
          balance: "1000000000000000000",
          decimals: 18,
          formatted: "1.0",
          id: "SN_MAIN:eth",
          name: "Ether",
          networkId: "SN_MAIN",
          symbol: "ETH",
        },
      ],
    });

    expect(html).toContain('id="refresh-button"');
    expect(html).toContain("ETH");
    // The token amount sits under the symbol; the fiat value fills the right side.
    expect(html).toContain(">1 ETH</p>");
    expect(html).toContain('class="token-amount"');
  });
});
