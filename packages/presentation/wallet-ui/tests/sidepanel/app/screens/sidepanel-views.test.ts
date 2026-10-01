/** Side-panel template and navigation contract checks. */
import { describe, expect, test } from "bun:test";
import { account, preferences, secondAccount } from "@bramble/testkit/sidepanel";
import type { TokenBalance, WalletStatus } from "../../../../src/popup/responses/responses";
import { dashboard, WALLET_VIEWS } from "../../../../src/sidepanel/app/screens/views";
import {
  activityEmptyCopy,
  homeTabs,
  visibleHomeBalances,
} from "../../../../src/sidepanel/journeys/portfolio/home-tabs";
import { settingsScreen } from "../../../../src/sidepanel/journeys/settings/settings-views";

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
    expect(html).toContain('class="wallet-dock"');
    expect(dock).toContain('data-view="home"');
    expect(dock).toContain('data-view="activity"');
    expect(dock).toContain('data-view="settings"');
    expect(dock).not.toContain('data-view="send"');
    expect(dock).not.toContain('data-view="receive"');
    expect(html).toContain('aria-controls="wallet-screen-home"');
    expect(html).toContain('aria-selected="true"');
    expect(dock).toContain('aria-label="Home" title="Home"');
    expect(dock).not.toContain('class="nav-label"');
    expect(dock).not.toContain('class="nav-tooltip"');
  });

  test("home keeps the frequent actions together, not settings or activity", () => {
    const html = dashboard("home", status, [], preferences, { balances: [] });
    const actions = html.slice(html.indexOf("action-row"), html.indexOf("home-tabs"));

    expect(actions).toContain('data-view="send"');
    expect(actions).toMatch(/data-view="send"[\s\S]*data-view="swap"[\s\S]*data-view="receive"/);
    expect(actions).toContain('data-view="receive"');
    expect(actions).not.toContain(">Portfolio</span>");
    expect(actions).not.toContain('data-view="settings"');
    expect(actions).not.toContain('data-view="activity"');
    expect(html).not.toContain('id="wallet-screen-receive"');
    // Account identity already lives in the header; the portfolio hero neither
    // renders nor repeats a copy pill for the address.
    expect(html).not.toContain(`<code>${account.address}`);
    expect(html).not.toContain(`data-copy="${account.address}"`);
  });

  test("receive is a dedicated flow screen with back navigation and no dock", () => {
    const html = dashboard("receive", status, [], preferences, { balances: [] });

    expect(html).toContain('id="wallet-screen-receive"');
    expect(html).toContain(account.address);
    expect(html).toContain(`data-copy="${account.publicKeyX}"`);
    expect(html).toMatch(/data-nav-back[^>]*aria-label="Back"/);
    expect(html).not.toMatch(/wallet-dock|role="tablist"/);
    expect(html).not.toContain('id="lock-button"');
  });

  test("settings is a menu of dedicated flows instead of inline controls", () => {
    const html = dashboard("settings", status, [], preferences, { balances: [] });

    expect(html).toMatch(/menu-row" data-view="network"[\s\S]*?Network/);
    expect(html).toContain('data-view="account"');
    expect(html).toContain('data-view="address-book"');
    expect(html).toContain('data-view="appearance"');
    expect(html).toContain('data-view="request-settings"');
    expect(html).toContain('data-view="connected-sites"');
    expect(html).toContain('data-view="allowances"');
    expect(html).toContain('data-view="backup"');
    expect(html).toContain('data-view="reveal"');
    expect(html).not.toContain('id="active-network"');
    expect(html).not.toContain('id="active-account"');
    expect(html).not.toContain('data-theme-id="dark"');
    expect(html).not.toContain('id="currency-select"');
    const appearance = dashboard("appearance", status, [], preferences, { balances: [] });
    expect(appearance).toContain('data-theme-id="dark"');
    expect(appearance).toContain('data-theme-id="light"');
    expect(appearance).toContain('id="currency-select"');
    const requests = dashboard("request-settings", status, [], preferences, { balances: [] });
    expect(requests).toContain('data-approval-surface="side-panel"');
    expect(requests).toContain('data-approval-surface="popup"');
    expect(requests).toMatch(/data-approval-surface="side-panel"[^>]*aria-pressed="true"/);
    expect(html).not.toContain('data-theme-id="system"');
    // The dock is a solid floating pill (Clean Mono — no glass material).
    expect(html).toContain('class="wallet-dock"');
  });

  test("settings stamps the build version and shows the branch only when unreleased", () => {
    const stamped = settingsScreen(status, preferences, {
      branch: "feature/68-strk20-privacy-sdk",
      version: "0.8.0",
    });
    expect(stamped).toContain("Version 0.8.0 · feature/68-strk20-privacy-sdk");

    const released = settingsScreen(status, preferences, { branch: "", version: "0.8.0" });
    expect(released).toContain("Version 0.8.0");
    expect(released).not.toContain("Version 0.8.0 ·");

    // Outside a built bundle no stamp is injected, so the line disappears
    // instead of showing an empty version.
    expect(settingsScreen(status, preferences)).not.toContain('id="settings-build"');
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
      {
        id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14",
        kind: "connect" as const,
        origin: "https://dapp.example",
      },
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
    expect(html).toMatch(/id="swap-confirm" hidden/);
    expect(html).toContain('<div id="swap-confirm-receipt"></div>');
    expect(html).not.toMatch(/<dl[^>]*id="swap-confirm-receipt"/);
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

  test("Home says nothing about an account that is not on chain yet", () => {
    // Home used to carry a "Deploy account" / "Fund with STRK" chip in the
    // danger colour. The first send creates the account and quotes both fees as
    // one, so the state is normal and the shortcut lives in Security &
    // permissions instead.
    const undeployed = dashboard("home", status, [], preferences, { balances: [] }, false);

    expect(undeployed).not.toContain("deploy-notice");
    expect(undeployed).not.toContain("Deploy account");
    expect(undeployed).not.toContain('data-view="deploy-account"');
    // The Shield tile's own "Fund with STRK" is a different control and stays:
    // shielding really does need STRK, whatever the account's deploy state.
    // The dedicated deployment flow is still reachable by its own route, and
    // that route has a way in: the Settings hub links to Security & permissions.
    expect(dashboard("security", status, [], preferences, { balances: [] }, false)).toContain(
      'data-view="deploy-account"',
    );
    expect(dashboard("settings", status, [], preferences, { balances: [] }, false)).toContain(
      'data-view="security"',
    );
  });

  test("deploys a single-signer account in a dedicated transaction flow", () => {
    const html = dashboard("deploy-account", status, [], preferences, { balances: [] }, false);
    expect(html).toContain('id="wallet-screen-deploy-account"');
    expect(html).toContain('id="deploy-review-stage"');
    expect(html).toContain("What will happen");
    expect(html).toContain("Risk and recovery");
    expect(html).toContain("Review deployment");
    expect(html).toMatch(/id="deploy-success"[^>]*hidden/);
    expect(html).not.toContain("wallet-dock");
  });

  test("send flow reviews before it sends, without a fee-speed control", () => {
    const html = dashboard("send", status, [], preferences, { balances: [] });

    expect(html).toContain('id="review-panel"');
    expect(html).not.toContain('name="speed"');
    expect(html).not.toContain(">Speed<");
    expect(html).toContain("Review send");
    expect(html).toContain('class="liquid-dots"');
    expect(html).toContain('data-liquid-dots="send"');
    expect(html).toContain('id="bramble-liquid-dots-send"');
    expect(html).not.toContain("send-spin");
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

    expect(html).toContain('class="tx-kind-icon tx-kind-transfer accepted"');
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
      [],
      null,
      false,
      null,
      [],
      false,
      null,
      true,
    );
    expect(degraded).toContain(
      "load on-chain history. Showing transactions recorded on this device only",
    );
    expect(degraded).toContain("No transactions recorded on this device yet.");
  });

  test("home Tokens tab renders a retryable error panel when the balance load failed", () => {
    // A failed balance load has no balances to hide, so visibleHomeBalances
    // collapses to an empty list and the panel shows the friendly error plus an
    // in-panel retry button wired to reload balances.
    expect(visibleHomeBalances({ error: "fetch failed" }, preferences)).toEqual([]);

    const html = homeTabs({ error: "fetch failed" }, preferences, {}, {}, "usd");
    expect(html).toContain("panel-error");
    expect(html).toContain("data-reload-balances");
    expect(html).toContain("Try again");
    expect(html).not.toContain("No tracked balances yet");
  });

  test("activity dock draws reachable and degraded copy from one shared source", () => {
    expect(activityEmptyCopy(true)).toBe("No transactions recorded on this device yet.");
    expect(activityEmptyCopy(false)).toContain("No activity yet.");

    const dockReachable = dashboard("activity", status, [], preferences, { balances: [] });
    expect(dockReachable).toContain(activityEmptyCopy(false));
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

  test("avatars are deterministic Beam characters from the identity palette", () => {
    // Account identity colour stays within the dedicated local tokens—no
    // gradients, remote imagery, raw colour values, or inset frames.
    const html = dashboard("home", status, [], preferences, { balances: [] });
    expect(html).toContain('class="avatar"');
    expect(html).toContain('class="avatar-character"');
    expect(html).toContain('class="avatar-eyes"');
    expect(html).toContain('class="avatar-mouth"');
    expect(html).toMatch(/fill="var\(--bramble-account-avatar-\d\)"/);
    expect(html).toMatch(/var\(--bramble-account-avatar-(?:ink|paper)\)/);
    expect(html).not.toContain('class="avatar-frame"');
    expect(html).not.toContain("linearGradient");
    expect(html).not.toContain("<defs>");
    expect(html).not.toMatch(/fill="#/);
  });

  test("home hero carries the value and 24h delta without redundant identity copy", () => {
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
    expect(hero).not.toContain('class="hero-eyebrow"');
    expect(hero).not.toContain("Total balance");
    expect(hero).not.toContain('data-copy="');
    // 24h delta line: coloured magnitude + a muted "· 24h" window; +4% ⇒ up.
    expect(hero).toContain('class="hero-change"');
    expect(hero).toContain('class="hero-change-amt"');
    expect(hero).toContain("· 24h");
    // The portfolio area chart was removed — the hero has no sparkline markup.
    expect(hero).not.toContain("hero-spark");
    expect(hero).not.toContain("spark-line");
    expect(hero).not.toContain("7d ago");
  });

  test("backup hub separates export and restore into focused screens", () => {
    const html = dashboard("backup", status, [], preferences, { balances: [] });

    expect(html).toContain('data-view="backup-export"');
    expect(html).toContain('data-view="backup-restore"');
    const backupExport = dashboard("backup-export", status, [], preferences, { balances: [] });
    expect(backupExport).toContain('id="backup-export"');
    const backupRestore = dashboard("backup-restore", status, [], preferences, { balances: [] });
    expect(backupRestore).toContain('id="backup-import"');
    expect(backupRestore).toContain("Saved contacts and tracked assets");
    expect(html).toMatch(/data-nav-back[^>]*aria-label="Back"/);
    expect(html).not.toContain('class="wallet-dock"');
  });

  test("account flow offers adding a derived account", () => {
    const html = dashboard("account", status, [], preferences, { balances: [] });

    expect(html).toContain('id="new-account"');
    expect(html).toContain("Add account");
    expect(html).toContain("Signer public key");
    expect(html).toContain(`data-copy="${account.publicKeyX}"`);
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
    // screen must use only public provenance so users trust the right backup.
    const imported = {
      accountContractType: "openzeppelin" as const,
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
    const contact = { address: "0x1", id: "c", label: "A", networkId: "SN_MAIN" as const };
    const withContact = {
      ...preferences,
      addressBook: [{ ...contact, publicKeyX: "0xabc" }],
    };
    const html = dashboard("address-book", status, [], withContact, { balances: [] });
    expect(html).toContain(`data-remove-address="${contact.id}"`);
    expect(html).toContain('name="publicKeyX"');
    expect(html).toContain('data-copy="0xabc"');
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
    expect(html).toContain(">1.00</p>");
    expect(html).toContain('class="token-amount"');
  });
});
