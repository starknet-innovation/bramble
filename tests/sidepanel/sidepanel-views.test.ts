/**
 * Side panel template checks: dock screens share the shell, flow screens are
 * dedicated goal journeys with back navigation, and wallet flows stay
 * separated.
 */
import { describe, expect, test } from "bun:test";
import type { TokenBalance, WalletStatus } from "../../src/popup/responses";
import { activityEmptyCopy, homeTabs, visibleHomeBalances } from "../../src/sidepanel/home-tabs";
import { dashboard, WALLET_VIEWS } from "../../src/sidepanel/views";
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

const dockSlice = (html: string): string => html.slice(html.indexOf("wallet-dock"));

describe("sidepanel views", () => {
  test("dock screens carry a bottom dock with home, activity, and settings only", () => {
    const html = dashboard("home", status, [], preferences, { balances: [] });
    const dock = dockSlice(html);

    expect(WALLET_VIEWS).toContain("receive");
    // The dock is a solid flat nav card (Clean Mono — no glass material).
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

  test("home keeps send, swap, and receive as quick actions, not settings or activity", () => {
    const html = dashboard("home", status, [], preferences, { balances: [] });
    const hero = html.slice(html.indexOf("hero"), html.indexOf("wallet-dock"));

    expect(hero).toContain('data-view="send"');
    // Swap sits between Send and Receive on the action row.
    expect(hero).toMatch(/data-view="send"[\s\S]*data-view="swap"[\s\S]*data-view="receive"/);
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
    expect(html).toMatch(/data-nav-back[^>]*aria-label="Back"/);
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
    // Theme is a two-way pin (Dark default / Light); the follow-the-browser
    // "system" option was removed.
    expect(html).toContain('data-theme-id="dark"');
    expect(html).toContain('data-theme-id="light"');
    expect(html).not.toContain('data-theme-id="system"');
    expect(html).toContain('id="currency-select"');
    expect(html).toContain('data-approval-surface="side-panel"');
    expect(html).toContain('data-approval-surface="popup"');
    expect(html).toMatch(/data-approval-surface="side-panel"[^>]*aria-pressed="true"/);
    // The dock is a solid anchored bottom bar (Clean Mono — no glass material).
    expect(html).toContain('class="wallet-dock"');
  });

  test("network flow lists networks, marks the active one, and returns to settings", () => {
    const html = dashboard("network", status, [], preferences, { balances: [] });

    expect(html).toMatch(/data-network-id="SN_MAIN"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/data-network-id="SN_SEPOLIA"[^>]*aria-pressed="false"/);
    expect(html).toMatch(/data-nav-back[^>]*aria-label="Back"/);
    expect(html).not.toContain("wallet-dock");
  });

  test("account flow lists network accounts and shows active identifiers", () => {
    const html = dashboard("account", status, [], preferences, { balances: [] });

    expect(html).toMatch(new RegExp(`data-account-id="${account.id}"[^>]*aria-pressed="true"`));
    expect(html).toMatch(
      new RegExp(`data-account-id="${secondAccount.id}"[^>]*aria-pressed="false"`),
    );
    expect(html).toContain(account.classHash);
    expect(html).toMatch(/data-nav-back[^>]*aria-label="Back"/);
    expect(html).not.toContain("wallet-dock");
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

  test("swap flow renders the AVNU screen skeleton with staged sections", () => {
    const html = dashboard("swap", status, [], preferences, { balances: [] });

    expect(html).toContain("Best route via AVNU");
    expect(html).toContain('id="swap-sell-amount"');
    expect(html).toContain('id="swap-flip"');
    expect(html).toContain('id="swap-review"');
    // Confirm and success stages ship hidden; the bindings stage them. The
    // success moment carries the drawn ring + check marks.
    expect(html).toMatch(/id="swap-confirm" hidden/);
    // The quote-sanity warning slot ships hidden; the bindings surface it when
    // a route returns materially less value than it costs.
    expect(html).toMatch(/id="swap-warning"[^>]*hidden/);
    expect(html).toMatch(/id="swap-success"[^>]*hidden/);
    expect(html).toContain('class="swap-success-ring"');
    expect(html).toContain('class="swap-success-check"');
    expect(html).toMatch(/data-nav-back[^>]*aria-label="Back"/);
    expect(html).not.toContain("wallet-dock");
  });

  test("explains why sending is unavailable instead of failing silently", () => {
    const html = dashboard("send", status, [], preferences, { balances: [] });

    expect(html).toContain("No tokens are tracked on this network yet");
    expect(html).toMatch(/id="send-review-button" type="submit" disabled/);
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
    expect(empty).toContain(
      "No activity yet. On-chain transactions for this account, and transactions you submit from this wallet, appear here.",
    );
    expect(empty).not.toContain("Couldn't load on-chain history");

    // historyUnavailable is the final positional arg: the full-screen degraded
    // notice must render so an empty feed never reads as the account's full
    // history when the chain source could not be reached. The penultimate arg is
    // classHashVerification (unrelated here, so null).
    const degraded = dashboard(
      "activity",
      status,
      [],
      preferences,
      { balances: [] },
      null,
      [],
      [],
      {},
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
      false,
      null,
      [],
      null,
      null,
      true,
    );
    expect(degraded).toContain(
      "load on-chain history. Showing transactions recorded on this device only",
    );
    expect(degraded).toContain("No transactions recorded on this device yet.");
  });

  test("home activity tab shows a degraded hint when on-chain history is unreachable", () => {
    const reachable = homeTabs({ balances: [] }, preferences, {}, {}, "usd", [], status, false);
    expect(reachable).not.toContain("On-chain history unavailable");

    const degraded = homeTabs({ balances: [] }, preferences, {}, {}, "usd", [], status, true);
    expect(degraded).toContain("On-chain history unavailable");
    expect(degraded).toContain("No transactions recorded on this device yet.");
  });

  test("home Tokens tab renders a retryable error panel when the balance load failed", () => {
    // A failed balance load has no balances to hide, so visibleHomeBalances
    // collapses to an empty list and the panel shows the friendly error plus an
    // in-panel retry button wired to reload balances.
    expect(visibleHomeBalances({ error: "fetch failed" }, preferences)).toEqual([]);

    const html = homeTabs({ error: "fetch failed" }, preferences, {}, {}, "usd", [], status, false);
    expect(html).toContain("panel-error");
    expect(html).toContain("data-reload-balances");
    expect(html).toContain("Try again");
    expect(html).not.toContain("No tracked balances yet");
  });

  test("home tab and activity dock draw empty-state copy from one shared source", () => {
    // Both surfaces must render byte-identical empty-state copy so a future
    // reword of one can never drift from the other.
    expect(activityEmptyCopy(true)).toBe("No transactions recorded on this device yet.");
    expect(activityEmptyCopy(false)).toContain("No activity yet.");

    const homeReachable = homeTabs({ balances: [] }, preferences, {}, {}, "usd", [], status, false);
    const dockReachable = dashboard("activity", status, [], preferences, { balances: [] });
    expect(homeReachable).toContain(activityEmptyCopy(false));
    expect(dockReachable).toContain(activityEmptyCopy(false));

    const homeDegraded = homeTabs({ balances: [] }, preferences, {}, {}, "usd", [], status, true);
    expect(homeDegraded).toContain(activityEmptyCopy(true));
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

  test("avatars are flat single-colour chips from the palette, never gradients", () => {
    // Clean Mono avatars: one solid --mc-avatar-* fill per account with a glyph
    // — no <linearGradient>, so the only non-mono field is the flat chip itself.
    const html = dashboard("home", status, [], preferences, { balances: [] });
    expect(html).toContain('class="avatar"');
    expect(html).toMatch(/fill="var\(--mc-avatar-\d\)"/);
    expect(html).toContain("var(--mc-avatar-ink)");
    expect(html).not.toContain("linearGradient");
    expect(html).not.toContain("<defs>");
  });

  test("home hero carries the total-balance label and 24h delta, and no chart", () => {
    const tokenBalance: TokenBalance = {
      address: "0x00aa",
      balance: "10000000000000000000",
      decimals: 18,
      formatted: "10",
      id: "SN_MAIN:TKN:0x00aa",
      name: "Token",
      networkId: "SN_MAIN",
      symbol: "TKN",
    };
    // positional args: …, balances(5), deployment(6), transactions(7),
    // connectedSites(8), prices(9), chart(10), selectedTokenId(11),
    // allowances(12), selectedNftId(13), changes(14). The chart series (10) is
    // still accepted for the token-detail flow but the home hero no longer
    // renders a sparkline from it.
    const html = dashboard(
      "home",
      status,
      [],
      preferences,
      { balances: [tokenBalance] },
      null,
      [],
      [],
      { "0x00aa": 5 },
      [1, 2, 3, 4],
      null,
      [],
      null,
      { "0x00aa": 4 },
    );
    const hero = html.slice(html.indexOf('class="hero"'), html.indexOf("action-row"));
    // Eyebrow label above the total.
    expect(hero).toContain('class="hero-eyebrow"');
    expect(hero).toContain("Total balance");
    // 24h delta line: coloured magnitude + a muted "· 24h" window; +4% ⇒ up.
    expect(hero).toContain('class="hero-change"');
    expect(hero).toContain('class="hero-change-amt"');
    expect(hero).toContain("· 24h");
    // The portfolio area chart was removed — the hero has no sparkline markup.
    expect(hero).not.toContain("hero-spark");
    expect(hero).not.toContain("spark-line");
    expect(hero).not.toContain("7d ago");
  });

  test("backup flow exports and restores non-secret data with back navigation", () => {
    const html = dashboard("backup", status, [], preferences, { balances: [] });

    expect(html).toContain('id="backup-export"');
    expect(html).toContain('id="backup-import"');
    expect(html).toContain('id="backup-file"');
    expect(html).toMatch(/data-nav-back[^>]*aria-label="Back"/);
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
    expect(html).toMatch(/data-nav-back[^>]*aria-label="Back"/);
    expect(html).not.toContain("wallet-dock");
    // An HD-derived active account is restorable from the recovery phrase, so no
    // imported-account caveat and no "(imported)" key label appear.
    expect(html).not.toContain('id="reveal-imported-note"');
    expect(html).not.toContain("(imported)");
  });

  test("reveal flow warns that the recovery phrase does not restore an imported active account", () => {
    // A raw-key-imported account is not derived from the wallet phrase; the
    // screen must say so, using only the provenance already in status (never a
    // secret), so a user does not wrongly trust the phrase as its backup.
    const imported = {
      address: "0xa11ceded",
      classHash: account.classHash,
      derivation: { kind: "imported-raw-key" as const },
      id: "SN_MAIN:0xa11ceded",
      networkId: "SN_MAIN" as const,
      publicKeyX: account.publicKeyX,
    };
    const importedStatus: WalletStatus = {
      ...status,
      accountCount: 1,
      accounts: [imported],
      activeAccountId: imported.id,
    };
    const html = dashboard("reveal", importedStatus, [], preferences, { balances: [] });

    expect(html).toContain('id="reveal-imported-note"');
    expect(html).toContain("does not restore it");
    expect(html).toContain("Active account private key (imported)");
    // The caveat is drawn from account provenance, never from key material.
    expect(html).not.toContain(imported.publicKeyX);
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
    expect(html).toContain(">1</p>");
    expect(html).toContain('class="token-amount"');
  });
});
