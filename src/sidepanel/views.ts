/**
 * Side panel screen composition. Dock screens (Home, Activity, Settings)
 * share the account-bar header, the bottom dock, and the account drawer;
 * every other view renders as a dedicated flow screen from ./flows.ts with
 * its own back navigation, so each journey has a distinct place to complete
 * its goal. Home follows a compact portfolio structure: hero balance, a row
 * of action tiles, then the tabbed Tokens/Collectibles/Activity section from
 * ./home-tabs.ts.
 */

import type {
  ConnectedSite,
  DiscoveredNft,
  PendingApproval,
  WalletStatus,
} from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { AllowanceView } from "../starknet/allowance-discovery";
import type { ActivityEntry } from "../storage/activity-store";
import type { MultisigProposalRecord, MultisigRecord } from "../storage/multisig-store";
import type { DisplayCurrency, WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { accountDrawer } from "./account-drawer";
import { allowancesFlow } from "./allowance-views";
import { approvalCard } from "./approval-cards";
import { formatFiat, formatPriceTimestamp, portfolioDelta, portfolioTotal } from "./fiat";
import {
  accountFlow,
  addressBookFlow,
  backupFlow,
  connectedSitesFlow,
  networkFlow,
  receiveFlow,
  sendFlow,
} from "./flows";
import { homeTabs, transactionRow, visibleHomeBalances } from "./home-tabs";
import { type IconName, icon } from "./icons";
import {
  multisigDeployFlow,
  multisigDetailFlow,
  multisigProposeFlow,
  multisigsFlow,
} from "./multisig-views";
import { nftDetailFlow, nftGalleryFlow } from "./nft-views";
import {
  accountAvatar,
  accountDisplayName,
  accountLabel,
  activeAccount,
  dockScreen,
  isWalletView,
  noAccountEmpty,
  WALLET_VIEWS,
  type WalletView,
} from "./parts";
import { revealFlow } from "./reveal-ui";
import type { BalanceState } from "./runtime";
import { DEFAULT_CURRENCY, tokenDetailFlow, tokensFlow } from "./token-flows";

/**
 * Re-exported screen contract so entrypoints and tests import one module.
 */
export { isWalletView, WALLET_VIEWS, type WalletView };

const walletHeader = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
): string => {
  const name = account ? accountDisplayName(account, preferences) : "MC Wallet";
  const network = status.network
    .replace(/^Starknet Mainnet$/, "Starknet")
    .replace(/^Starknet\s+/, "");
  return `
  <header class="wallet-header">
    <button id="account-trigger" class="account-trigger" type="button" aria-haspopup="dialog" aria-expanded="false" title="Manage accounts">
      <span class="brand-mark">${account ? accountAvatar(account.address) : icon("wallet")}</span>
      <span class="account-meta">
        <span class="account-name"><strong>${escapeHtml(name)}</strong>${icon("chevronDown")}</span>
        <span class="account-net"><span class="dot"></span>${escapeHtml(network)}</span>
      </span>
    </button>
    <div class="header-actions">
      <button class="icon-button ghost" data-view="connected-sites" type="button" aria-label="Connected sites" title="Connected sites">${icon("link")}</button>
      <button id="lock-button" class="icon-button ghost" type="button" aria-label="Lock wallet" title="Lock wallet">${icon("lock")}</button>
    </div>
  </header>`;
};

const dockItem = (
  activeView: WalletView,
  view: WalletView,
  label: string,
  name: IconName,
  pendingCount = 0,
): string =>
  `<button class="nav-item" data-view="${view}" type="button" role="tab" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" aria-controls="wallet-screen-${view}" aria-selected="${activeView === view}">
    <span class="tab-icon">${icon(name)}${pendingCount > 0 && view === "activity" ? `<span class="badge">${pendingCount}</span>` : ""}</span>
    <span class="tab-label">${escapeHtml(label)}</span>
  </button>`;

const walletDock = (activeView: WalletView, pendingCount: number): string => `
  <nav class="wallet-dock" aria-label="Wallet screens" role="tablist">
    ${dockItem(activeView, "home", "Home", "home")}
    ${dockItem(activeView, "activity", "Activity", "activity", pendingCount)}
    ${dockItem(activeView, "settings", "Settings", "settings")}
  </nav>`;

const pendingCallout = (pendingCount: number): string =>
  pendingCount === 0
    ? ""
    : `<section class="callout" role="note">
        <span class="callout-icon">${icon("link")}</span>
        <div class="callout-copy">
          <strong>${pendingCount} connection ${pendingCount === 1 ? "request" : "requests"} waiting</strong>
          <p>Review before any site can see your accounts.</p>
        </div>
        <button class="secondary small" data-view="activity" type="button">Review</button>
      </section>`;

const actionTile = (
  view: WalletView,
  label: string,
  name: IconName,
  primary: boolean,
  enabled: boolean,
): string =>
  `<button class="action-tile${primary ? " primary" : ""}" data-view="${view}" type="button" ${enabled ? "" : "disabled"}>
    <span class="tile-icon">${icon(name)}</span>
    <span class="tile-label">${escapeHtml(label)}</span>
  </button>`;

const deployNotice = (account: AccountRef | null, deployment: boolean | null): string =>
  account === null || deployment !== false
    ? ""
    : `<div class="deploy-notice">
        <button id="deploy-button" class="secondary small deploy-chip" type="button" title="This account contract is not on-chain yet. Deploying it enables transactions.">
          ${icon("alert")}Not deployed — deploy now
        </button>
        <p id="deploy-result" role="status"></p>
      </div>`;

// The portfolio 24h delta line under the balance: a green/red arrow and
// magnitude beside a muted "percent · 24h" trailing label. Empty when nothing
// is priced yet (no baseline), so it never renders a misleading zero-change.
const heroDelta = (
  balances: BalanceState,
  preferences: WalletPreferences | null,
  prices: Readonly<Record<string, number>>,
  changes: Readonly<Record<string, number>>,
  currency: DisplayCurrency,
): string => {
  const delta = portfolioDelta(visibleHomeBalances(balances, preferences), prices, changes);
  if (delta === null) {
    return "";
  }
  const arrow = delta.direction === "up" ? "↑" : "↓";
  return `<p class="hero-change${delta.direction === "down" ? " down" : ""}">
      <span class="hero-change-amt">${arrow} ${escapeHtml(formatFiat(delta.absolute, currency))}</span>
      <span class="hero-change-win">${delta.percent.toFixed(2)}% · 24h</span>
    </p>`;
};

// A degraded-mode notice under the hero total. When the price host is
// unreachable we serve the last saved prices (or nothing, when the cache is
// empty), always labelled so a stale value never masquerades as a live one:
// cached prices read as "last saved · <time>", an empty cache reads as an
// explicit "unavailable" hint. Empty when prices are current.
const heroPriceNotice = (
  priceStale: boolean,
  hasPrices: boolean,
  priceAsOf: number | null,
): string => {
  if (!priceStale) {
    return "";
  }
  const savedAt = formatPriceTimestamp(priceAsOf);
  const copy = hasPrices
    ? `Showing last saved prices${savedAt ? ` · ${savedAt}` : ""}`
    : "Live prices unavailable right now";
  return `<p class="hero-stale" role="status">${icon("alert")}<span>${escapeHtml(copy)}</span></p>`;
};

const homeScreen = (
  status: WalletStatus,
  account: AccountRef | null,
  balances: BalanceState,
  pendingCount: number,
  deployment: boolean | null,
  preferences: WalletPreferences | null,
  prices: Readonly<Record<string, number>>,
  changes: Readonly<Record<string, number>>,
  currency: DisplayCurrency,
  transactions: readonly ActivityEntry[],
  priceStale: boolean,
  priceAsOf: number | null,
): string => {
  const showTotal = account !== null && Object.keys(prices).length > 0;
  const total = showTotal ? portfolioTotal(visibleHomeBalances(balances, preferences), prices) : 0;
  return dockScreen(
    "home",
    `${pendingCallout(pendingCount)}
    <section class="hero">
      <p class="hero-eyebrow">Total balance</p>
      <p class="hero-total">${showTotal ? escapeHtml(formatFiat(total, currency)) : "—"}</p>
      ${showTotal ? heroDelta(balances, preferences, prices, changes, currency) : ""}
      ${account !== null ? heroPriceNotice(priceStale, showTotal, priceAsOf) : ""}
      ${
        account
          ? `<button class="hero-chip" data-copy="${escapeHtml(account.address)}" type="button" title="Copy address">${escapeHtml(accountLabel(account.address))}${icon("copy")}</button>`
          : noAccountEmpty(status)
      }
      ${deployNotice(account, deployment)}
    </section>
    <div class="action-row">
      ${actionTile("send", "Send", "send", true, account !== null)}
      ${actionTile("receive", "Receive", "receive", false, account !== null)}
    </div>
    ${homeTabs(balances, preferences, prices, changes, currency, transactions, status)}`,
  );
};

const activityScreen = (
  pending: readonly PendingApproval[],
  status: WalletStatus,
  transactions: readonly ActivityEntry[],
): string =>
  dockScreen(
    "activity",
    `<section class="section">
      <div class="row"><h2>Requests</h2><span class="pill">${pending.length} pending</span></div>
      ${
        pending.length === 0
          ? '<p class="empty">Nothing waiting on you. Connection requests from sites appear here.</p>'
          : `<ul class="request-list">${pending.map((approval) => approvalCard(approval, status)).join("")}</ul>`
      }
      <p id="approval-result" role="status"></p>
    </section>
    <section class="section">
      <div class="row">
        <h2>Transactions</h2>
        <div class="header-actions">
          <button id="activity-export" class="icon-button" type="button" aria-label="Export CSV" title="Export CSV" ${transactions.length === 0 ? "disabled" : ""}>${icon("receive")}</button>
          <button id="activity-refresh" class="icon-button" type="button" aria-label="Refresh transactions" title="Refresh transactions">${icon("refresh")}</button>
        </div>
      </div>
      ${
        transactions.length === 0
          ? '<p class="empty">Transactions you submit from this wallet appear here.</p>'
          : `<ul class="tx-list">${transactions.map(transactionRow).join("")}</ul>`
      }
      <p id="activity-result" role="status"></p>
    </section>`,
  );

const menuRow = (view: WalletView, label: string, name: IconName): string =>
  `<button class="menu-row" data-view="${view}" type="button">
    <span class="menu-icon">${icon(name)}</span>
    <span class="menu-copy"><strong>${escapeHtml(label)}</strong></span>
    <span class="menu-chevron">${icon("chevronRight")}</span>
  </button>`;

const settingsScreen = (_status: WalletStatus, preferences: WalletPreferences | null): string =>
  dockScreen(
    "settings",
    // Preferences (theme + display currency) lead the screen, ahead of the tall
    // navigation menu. Settings content overflows the panel, so the sticky dock
    // pins over whatever sits at the viewport fold; keeping the compact inline
    // controls up top means the Appearance Dark/Light toggle is fully visible on
    // open instead of clipped under the dock, while the deeper flow links below
    // simply scroll into view (matching the Activity screen's behaviour).
    `<h2>Settings</h2>
    <p class="eyebrow">Appearance</p>
    <div class="option-list" role="group" aria-label="Theme">
      ${(["system", "dark", "light"] as const)
        .map((theme) => {
          const active = (preferences?.theme ?? "system") === theme;
          const label = theme === "system" ? "System" : theme === "light" ? "Light" : "Dark";
          const hint =
            theme === "system" ? `<span class="option-sub">Match the browser</span>` : "";
          return `<button class="option-row" data-theme-id="${theme}" type="button" aria-pressed="${active}">
            <span class="option-copy"><strong>${label}</strong>${hint}</span>
            ${active ? `<span class="option-mark">${icon("check")}</span>` : ""}
          </button>`;
        })
        .join("")}
    </div>
    <label><span>Display currency</span>
      <select id="currency-select">
        ${(["usd", "eur", "gbp"] as const)
          .map(
            (currency) =>
              `<option value="${currency}" ${(preferences?.displayCurrency ?? "usd") === currency ? "selected" : ""}>${currency.toUpperCase()}</option>`,
          )
          .join("")}
      </select>
    </label>
    <div class="menu-list" role="group" aria-label="Wallet settings">
      ${menuRow("network", "Network", "globe")}
      ${menuRow("account", "Manage accounts & groups", "wallet")}
      ${menuRow("address-book", "Address book", "book")}
      ${menuRow("connected-sites", "Connected sites", "link")}
      ${menuRow("allowances", "Allowances", "coins")}
      ${menuRow("multisigs", "Multisigs", "users")}
      ${menuRow("backup", "Backup & restore", "shield")}
      ${menuRow("reveal", "Reveal secrets", "lock")}
    </div>
    <a class="menu-row" href="https://github.com/mc-wallet/mc-wallet#readme" target="_blank" rel="noreferrer">
      <span class="menu-icon">${icon("book")}</span>
      <span class="menu-copy"><strong>Help &amp; docs</strong></span>
      <span class="menu-chevron">${icon("chevronRight")}</span>
    </a>
    <p id="display-result" role="status"></p>`,
  );

/**
 * Renders the unlocked wallet for the active screen: dock screens with the
 * shared shell, flow screens standalone. `deployment` is the active account's
 * on-chain contract status (null while unknown).
 */
export const dashboard = (
  activeView: WalletView,
  status: WalletStatus,
  pending: readonly PendingApproval[],
  preferences: WalletPreferences | null,
  balances: BalanceState,
  deployment: boolean | null = null,
  transactions: readonly ActivityEntry[] = [],
  connectedSites: readonly ConnectedSite[] = [],
  prices: Readonly<Record<string, number>> = {},
  chart: readonly number[] = [],
  selectedTokenId: string | null = null,
  allowances: readonly AllowanceView[] = [],
  selectedNftId: string | null = null,
  changes: Readonly<Record<string, number>> = {},
  multisigs: readonly MultisigRecord[] = [],
  multisigProposals: readonly MultisigProposalRecord[] = [],
  selectedMultisigId: string | null = null,
  multisigClassDeclared: boolean | "error" | null = null,
  drawerGroupFilter: string | null = null,
  expandedGroupId: string | null = null,
  priceStale = false,
  priceAsOf: number | null = null,
  discoveredNfts: readonly DiscoveredNft[] = [],
  openAssignId: string | null = null,
): string => {
  const account = activeAccount(status);
  const currency = preferences?.displayCurrency ?? DEFAULT_CURRENCY;
  const trackedBalances = "balances" in balances ? balances.balances : [];
  if (activeView === "send") {
    return sendFlow(status, account, preferences);
  }
  if (activeView === "receive") {
    return receiveFlow(status, account);
  }
  if (activeView === "network") {
    return networkFlow(status, preferences);
  }
  if (activeView === "account") {
    return accountFlow(status, account, preferences, expandedGroupId);
  }
  if (activeView === "address-book") {
    return addressBookFlow(status, preferences);
  }
  if (activeView === "connected-sites") {
    return connectedSitesFlow(status, connectedSites);
  }
  if (activeView === "allowances") {
    return allowancesFlow(status, account, allowances);
  }
  if (activeView === "multisigs") {
    return multisigsFlow(status, account, multisigs, multisigProposals);
  }
  if (activeView === "multisig-detail" || activeView === "multisig-propose") {
    const selected = multisigs.find(
      (record) => record.id === selectedMultisigId && record.networkId === status.networkId,
    );
    return activeView === "multisig-detail"
      ? multisigDetailFlow(status, account, selected ?? null, multisigProposals)
      : multisigProposeFlow(status, selected ?? null);
  }
  if (activeView === "multisig-deploy") {
    return multisigDeployFlow(status, account, multisigClassDeclared);
  }
  if (activeView === "nfts") {
    return nftGalleryFlow(status, account, preferences, discoveredNfts);
  }
  if (activeView === "nft-detail") {
    return nftDetailFlow(status, account, preferences, selectedNftId, discoveredNfts);
  }
  if (activeView === "backup") {
    return backupFlow(status);
  }
  if (activeView === "tokens") {
    return tokensFlow(status, preferences, trackedBalances, prices, currency);
  }
  if (activeView === "token-detail") {
    const token = (preferences?.tokens ?? []).find(
      (stored) => stored.id === selectedTokenId && stored.networkId === status.networkId,
    );
    if (token) {
      const price =
        chart.length > 0 ? (chart[chart.length - 1] ?? null) : (prices[token.address] ?? null);
      return tokenDetailFlow(
        status,
        token,
        trackedBalances.find((balance) => balance.id === token.id),
        chart,
        price,
        currency,
      );
    }
  }
  if (activeView === "reveal") {
    return revealFlow(status);
  }
  const screen =
    activeView === "activity"
      ? activityScreen(pending, status, transactions)
      : activeView === "settings"
        ? settingsScreen(status, preferences)
        : homeScreen(
            status,
            account,
            balances,
            pending.length,
            deployment,
            preferences,
            prices,
            changes,
            currency,
            transactions,
            priceStale,
            priceAsOf,
          );
  return `
    ${walletHeader(status, account, preferences)}
    ${screen}
    ${walletDock(activeView, pending.length)}
    ${accountDrawer(status, account, preferences, drawerGroupFilter, openAssignId)}`;
};
