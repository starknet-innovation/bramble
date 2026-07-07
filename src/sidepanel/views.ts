/**
 * Side panel screen composition. Dock screens (Home, Activity, Settings)
 * share the brand header and the bottom dock; every other view renders as a
 * dedicated flow screen from ./flows.ts with its own back navigation, so each
 * journey has a distinct place to complete its goal.
 */

import type { PendingApproval, WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { ActivityEntry } from "../storage/activity-store";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import {
  accountFlow,
  addressBookFlow,
  backupFlow,
  networkFlow,
  receiveFlow,
  sendFlow,
} from "./flows";
import { type IconName, icon } from "./icons";
import {
  accountAvatar,
  accountDisplayName,
  accountLabel,
  activeAccount,
  copyButton,
  dockScreen,
  isWalletView,
  networkOptions,
  networkPill,
  noAccountEmpty,
  WALLET_VIEWS,
  type WalletView,
} from "./parts";
import type { BalanceState } from "./runtime";

/**
 * Re-exported screen contract so entrypoints and tests import one module.
 */
export { isWalletView, networkOptions, WALLET_VIEWS, type WalletView };

const walletHeader = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
): string => `
  <header class="wallet-header">
    <div class="brand">
      <span class="brand-mark">${account ? accountAvatar(account.address) : icon("wallet")}</span>
      <div class="brand-copy">
        <h1>${escapeHtml(account ? accountDisplayName(account, preferences) : "MC Wallet")}</h1>
        <p class="brand-context">${escapeHtml(account ? accountLabel(account.address) : status.network)}</p>
      </div>
    </div>
    <div class="header-actions">
      <button id="lock-button" class="icon-button" type="button" aria-label="Lock wallet" title="Lock wallet">${icon("lock")}</button>
    </div>
  </header>`;

const dockItem = (
  activeView: WalletView,
  view: WalletView,
  label: string,
  name: IconName,
  pendingCount = 0,
): string =>
  `<button class="nav-item" data-view="${view}" type="button" role="tab" aria-controls="wallet-screen-${view}" aria-selected="${activeView === view}">
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

const balancePanel = (state: BalanceState): string => `
  <section class="section">
    <div class="row">
      <h2>Balances</h2>
      <button id="refresh-button" class="icon-button" type="button" aria-label="Refresh balances" title="Refresh balances">${icon("refresh")}</button>
    </div>
    ${
      "error" in state
        ? `<p class="empty">${escapeHtml(state.error)}</p>`
        : state.balances.length === 0
          ? '<p class="empty">No tracked balances yet. Tokens you hold appear here.</p>'
          : `<ul class="token-list">${state.balances
              .map(
                (token) => `<li class="token-row">
                  <span class="token-mark">${escapeHtml(token.symbol.slice(0, 3))}</span>
                  <div class="token-copy">
                    <strong>${escapeHtml(token.symbol)}</strong>
                    <p>${escapeHtml(token.name)}</p>
                  </div>
                  <span class="token-amount">${escapeHtml(token.formatted)}</span>
                </li>`,
              )
              .join("")}</ul>`
    }
    <p id="panel-result" role="status"></p>
  </section>`;

const deployNotice = (account: AccountRef | null, deployment: boolean | null): string =>
  account === null || deployment !== false
    ? ""
    : `<div class="deploy-notice">
        <button id="deploy-button" class="secondary small deploy-chip" type="button" title="This account contract is not on-chain yet. Deploying it enables transactions.">
          ${icon("alert")}Not deployed — deploy now
        </button>
        <p id="deploy-result" role="status"></p>
      </div>`;

const homeScreen = (
  status: WalletStatus,
  account: AccountRef | null,
  balances: BalanceState,
  pendingCount: number,
  deployment: boolean | null,
): string =>
  dockScreen(
    "home",
    `${pendingCallout(pendingCount)}
    <section class="section hero">
      <div class="row">
        <p class="eyebrow">Active account</p>
        ${networkPill(status)}
      </div>
      ${
        account
          ? `<p class="hero-address"><code>${escapeHtml(accountLabel(account.address))}</code></p>`
          : noAccountEmpty(status)
      }
      ${deployNotice(account, deployment)}
      <div class="button-row">
        <button data-view="send" type="button" ${account ? "" : "disabled"}>${icon("send")}Send</button>
        <button class="secondary" data-view="receive" type="button" ${account ? "" : "disabled"}>${icon("receive")}Receive</button>
      </div>
    </section>
    ${balancePanel(balances)}`,
  );

const approvalCard = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      <p class="eyebrow">Connection request</p>
      <p class="request-origin">${escapeHtml(approval.origin)}</p>
      <p class="hint">${status.locked ? "Unlock the wallet to approve this site." : "Once approved, this site can see your granted account addresses."}</p>
    </div>
    <div class="button-row">
      <button data-approval-action="approve" data-approval-id="${escapeHtml(approval.id)}" type="button" ${status.locked ? "disabled" : ""}>${icon("check")}Approve</button>
      <button class="secondary danger" data-approval-action="deny" data-approval-id="${escapeHtml(approval.id)}" type="button">${icon("x")}Deny</button>
    </div>
  </li>`;

const transactionRow = (entry: ActivityEntry): string => `
  <li class="tx-row">
    <span class="tx-status ${entry.status}">${escapeHtml(entry.status)}</span>
    <div class="tx-copy">
      <strong>${escapeHtml(entry.summary)}</strong>
      <code>${escapeHtml(`${entry.hash.slice(0, 10)}…${entry.hash.slice(-6)}`)}</code>
    </div>
    ${copyButton(entry.hash, "Copy transaction hash")}
  </li>`;

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

const menuRow = (view: WalletView, label: string, value: string, name: IconName): string =>
  `<button class="menu-row" data-view="${view}" type="button">
    <span class="menu-icon">${icon(name)}</span>
    <span class="menu-copy">
      <span class="menu-label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </span>
    <span class="menu-chevron">${icon("chevronRight")}</span>
  </button>`;

const settingsScreen = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
): string => {
  const networkAccounts = status.accounts.filter((stored) => stored.networkId === status.networkId);
  const addresses =
    preferences?.addressBook.filter((entry) => entry.networkId === status.networkId) ?? [];
  return dockScreen(
    "settings",
    `<section class="section">
      <div class="row"><h2>Settings</h2>${networkPill(status)}</div>
      <div class="menu-list" role="group" aria-label="Wallet settings">
        ${menuRow("network", "Network", status.network, "globe")}
        ${menuRow("account", "Account", account ? accountDisplayName(account, preferences) : "No account", "wallet")}
        ${menuRow("address-book", "Address book", `${addresses.length} saved`, "book")}
        ${menuRow("backup", "Backup & restore", "Non-secret wallet data", "receive")}
      </div>
      <div class="detail-grid">
        <div class="detail"><p>Accounts</p><p class="value">${status.accountCount}</p></div>
        <div class="detail"><p>On this network</p><p class="value">${networkAccounts.length}</p></div>
      </div>
    </section>
    <section class="section">
      <h2>Appearance</h2>
      <div class="option-list" role="group" aria-label="Theme">
        ${(["light", "dark"] as const)
          .map(
            (
              theme,
            ) => `<button class="option-row" data-theme-id="${theme}" type="button" aria-pressed="${(preferences?.theme ?? "light") === theme}">
              <span class="option-copy"><strong>${theme === "light" ? "Light" : "Dark"}</strong></span>
              ${(preferences?.theme ?? "light") === theme ? `<span class="option-mark">${icon("check")}</span>` : ""}
            </button>`,
          )
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
      <a class="menu-row" href="https://github.com/mc-wallet/mc-wallet#readme" target="_blank" rel="noreferrer">
        <span class="menu-icon">${icon("book")}</span>
        <span class="menu-copy">
          <span class="menu-label">Help</span>
          <strong>Documentation</strong>
        </span>
        <span class="menu-chevron">${icon("chevronRight")}</span>
      </a>
      <p id="display-result" role="status"></p>
    </section>`,
  );
};

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
): string => {
  const account = activeAccount(status);
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
    return accountFlow(status, account, preferences);
  }
  if (activeView === "address-book") {
    return addressBookFlow(status, preferences);
  }
  if (activeView === "backup") {
    return backupFlow(status);
  }
  const screen =
    activeView === "activity"
      ? activityScreen(pending, status, transactions)
      : activeView === "settings"
        ? settingsScreen(status, account, preferences)
        : homeScreen(status, account, balances, pending.length, deployment);
  return `
    ${walletHeader(status, account, preferences)}
    ${screen}
    ${walletDock(activeView, pending.length)}`;
};
