/**
 * Side panel screen composition. Dock screens (Home, Activity, Settings)
 * share the brand header and the bottom dock; every other view renders as a
 * dedicated flow screen from ./flows.ts with its own back navigation, so each
 * journey has a distinct place to complete its goal.
 */

import type {
  ConnectedSite,
  PendingApproval,
  TokenBalance,
  WalletStatus,
} from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { ActivityEntry } from "../storage/activity-store";
import type { AllowanceRecord } from "../storage/allowance-store";
import type { DisplayCurrency, TokenConfig, WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { allowancesFlow } from "./allowance-views";
import { formatFiat, portfolioTotal } from "./fiat";
import {
  accountFlow,
  addressBookFlow,
  backupFlow,
  connectedSitesFlow,
  networkFlow,
  receiveFlow,
  sendFlow,
} from "./flows";
import { type IconName, icon } from "./icons";
import { nftDetailFlow, nftGalleryFlow } from "./nft-views";
import {
  accountAvatar,
  accountDisplayName,
  accountLabel,
  activeAccount,
  copyButton,
  dockScreen,
  isWalletView,
  networkOptions,
  noAccountEmpty,
  WALLET_VIEWS,
  type WalletView,
} from "./parts";
import { revealFlow } from "./reveal-ui";
import type { BalanceState } from "./runtime";
import { DEFAULT_CURRENCY, isHiddenFromHome, tokenDetailFlow, tokensFlow } from "./token-flows";
import { balanceRow } from "./token-row";

/**
 * Re-exported screen contract so entrypoints and tests import one module.
 */
export { isWalletView, networkOptions, WALLET_VIEWS, type WalletView };

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
    <span class="brand-mark">${account ? accountAvatar(account.address) : icon("wallet")}</span>
    <div class="account-id">
      <strong>${escapeHtml(name)}</strong>
      <span class="account-sep">|</span>
      <span class="dot"></span>
      <span class="account-net">${escapeHtml(network)}</span>
    </div>
    <button id="lock-button" class="icon-button" type="button" aria-label="Lock wallet" title="Lock wallet">${icon("lock")}</button>
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

const visibleBalances = (
  state: BalanceState,
  preferences: WalletPreferences | null,
): readonly TokenBalance[] => {
  if ("error" in state) {
    return [];
  }
  const trackedById = new Map<string, TokenConfig>(
    (preferences?.tokens ?? []).map((token) => [token.id, token]),
  );
  return state.balances.filter((balance) => {
    const token = trackedById.get(balance.id);
    return !token || !isHiddenFromHome(token, preferences);
  });
};

const quickAction = (
  view: WalletView,
  label: string,
  name: IconName,
  primary: boolean,
  enabled: boolean,
): string =>
  `<button class="quick-action${primary ? " primary" : ""}" data-view="${view}" type="button" ${enabled ? "" : "disabled"}>
    <span class="quick-disc">${icon(name)}</span>
    <span class="quick-label">${escapeHtml(label)}</span>
  </button>`;

const balancePanel = (
  state: BalanceState,
  preferences: WalletPreferences | null,
  prices: Readonly<Record<string, number>>,
  changes: Readonly<Record<string, number>>,
  currency: DisplayCurrency,
): string => {
  const visible = visibleBalances(state, preferences);
  const hiddenCount = "error" in state ? 0 : state.balances.length - visible.length;
  return `
  <section class="stack" aria-label="Balances">
    <div class="section-head">
      <h2>Tokens</h2>
      <div class="header-actions">
        <button class="icon-button" data-view="tokens" type="button" aria-label="Manage tokens" title="Manage tokens">${icon("plus")}</button>
        <button id="refresh-button" class="icon-button" type="button" aria-label="Refresh balances" title="Refresh balances">${icon("refresh")}</button>
      </div>
    </div>
    ${
      "error" in state
        ? `<p class="empty">${escapeHtml(state.error)}</p>`
        : visible.length === 0
          ? '<p class="empty">No tracked balances yet. Add or detect tokens to see them here.</p>'
          : `<ul class="token-list">${visible
              .map((token) =>
                balanceRow(token, prices[token.address], changes[token.address], currency),
              )
              .join("")}</ul>`
    }
    ${
      hiddenCount > 0
        ? `<button class="menu-row" data-view="tokens" type="button"><span class="menu-copy"><strong>Hidden tokens</strong></span><span class="menu-value">${hiddenCount} hidden</span><span class="menu-chevron">${icon("chevronRight")}</span></button>`
        : ""
    }
    <p id="panel-result" role="status"></p>
  </section>`;
};

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
  preferences: WalletPreferences | null,
  prices: Readonly<Record<string, number>>,
  changes: Readonly<Record<string, number>>,
  currency: DisplayCurrency,
): string => {
  const showTotal = account !== null && Object.keys(prices).length > 0;
  const total = showTotal ? portfolioTotal(visibleBalances(balances, preferences), prices) : 0;
  return dockScreen(
    "home",
    `${pendingCallout(pendingCount)}
    <section class="hero">
      <p class="hero-total">${showTotal ? escapeHtml(formatFiat(total, currency)) : "—"}</p>
      ${
        account
          ? `<button class="hero-chip" data-copy="${escapeHtml(account.address)}" type="button" title="Copy address">${escapeHtml(accountLabel(account.address))}${icon("copy")}</button>`
          : noAccountEmpty(status)
      }
      ${deployNotice(account, deployment)}
    </section>
    <div class="quick-actions">
      ${quickAction("send", "Send", "send", true, account !== null)}
      ${quickAction("receive", "Receive", "receive", false, account !== null)}
      ${quickAction("nfts", "NFTs", "image", false, true)}
    </div>
    ${balancePanel(balances, preferences, prices, changes, currency)}`,
  );
};

// Renders a note panel of user-facing warning lines (reputation insights and/or
// decoded risk-flag messages). Empty input renders nothing.
const reviewPanel = (items: readonly string[]): string =>
  items.length === 0
    ? ""
    : `<div class="review-panel" role="note">${items
        .map((item) => `<p class="review-flag">${icon("alert")}${escapeHtml(item)}</p>`)
        .join("")}</div>`;

// Shared approve/deny controls (one long template line so it is not re-wrapped);
// `approve` is disabled when the wallet is locked or the origin is blocked.
const decisionRow = (approval: PendingApproval, label: string, locked: boolean): string =>
  `<div class="button-row"><button data-approval-action="approve" data-approval-id="${escapeHtml(approval.id)}" type="button" ${locked || approval.blocked ? "disabled" : ""}>${icon("check")}${label}</button><button class="secondary danger" data-approval-action="deny" data-approval-id="${escapeHtml(approval.id)}" type="button">${icon("x")}Deny</button></div>`;

const connectCard = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      <p class="eyebrow">Connection request</p>
      <p class="request-origin">${escapeHtml(approval.origin)}</p>
      <p class="hint">${status.locked ? "Unlock the wallet to approve this site." : "Once approved, this site can see your granted account addresses."}</p>
    </div>
    ${reviewPanel(approval.insights ?? [])}
    ${decisionRow(approval, "Approve", status.locked)}
  </li>`;

const watchAssetCard = (approval: PendingApproval): string => {
  const token = approval.token;
  if (!token) {
    return "";
  }
  return `
  <li class="request-card">
    <div class="request-copy">
      <p class="eyebrow">Add token request</p>
      <p class="request-origin">${escapeHtml(approval.origin)}</p>
      <dl class="request-detail"><div><dt>Symbol</dt><dd>${escapeHtml(token.symbol)}</dd></div><div><dt>Name</dt><dd>${escapeHtml(token.name)}</dd></div><div><dt>Decimals</dt><dd>${escapeHtml(String(token.decimals))}</dd></div><div><dt>Address</dt><dd><code>${escapeHtml(accountLabel(token.address))}</code></dd></div></dl>
      <p class="hint">Approve to track this ERC20 token in your wallet.</p>
    </div>
    ${reviewPanel(approval.insights ?? [])}
    ${decisionRow(approval, "Add token", false)}
  </li>`;
};

// Everything is inlined into the template (template contents are not re-wrapped)
// so the decoded calls and combined risk-flag/insight warnings stay compact.
const invokeCard = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      <p class="eyebrow">Transaction request</p>
      <p class="request-origin">${escapeHtml(approval.origin)}</p>
      <p class="hint">${status.locked ? "Unlock the wallet to review and approve this transaction." : "Review each call carefully. Approving signs and submits it from your active account."}</p>
      ${!approval.summaries?.length ? "" : `<ul class="review-calls">${approval.summaries.map((summary) => `<li class="review-call">${escapeHtml(summary)}</li>`).join("")}</ul>`}
    </div>
    ${reviewPanel([...(approval.flags ?? []).map((flag) => flag.message), ...(approval.insights ?? [])])}
    ${decisionRow(approval, "Approve", status.locked)}
  </li>`;

const signCard = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      <p class="eyebrow">Sign request</p>
      <p class="request-origin">${escapeHtml(approval.origin)}</p>
      <p class="hint">${status.locked ? "Unlock the wallet to review and sign this message." : "This site asked you to sign a typed message. Signing does not move funds, but only sign messages you understand."}</p>
      ${!approval.summaries?.length ? "" : `<ul class="review-calls">${approval.summaries.map((summary) => `<li class="review-call">${escapeHtml(summary)}</li>`).join("")}</ul>`}
    </div>
    ${reviewPanel(approval.insights ?? [])}
    ${decisionRow(approval, "Sign", status.locked)}
  </li>`;

const approvalCard = (approval: PendingApproval, status: WalletStatus): string =>
  approval.kind === "watch-asset"
    ? watchAssetCard(approval)
    : approval.kind === "invoke"
      ? invokeCard(approval, status)
      : approval.kind === "sign-typed-data"
        ? signCard(approval, status)
        : connectCard(approval, status);
const PENDING_TX_HINT =
  "Pending Starknet transactions cannot be sped up or cancelled and usually settle within a few minutes.";

const transactionRow = (entry: ActivityEntry): string => `
  <li class="tx-row">
    <span class="tx-status ${entry.status}"${entry.status === "pending" ? ` title="${escapeHtml(PENDING_TX_HINT)}"` : ""}>${escapeHtml(entry.status)}</span>
    <div class="tx-copy">
      <strong>${escapeHtml(entry.summary)}</strong>
      <code>${escapeHtml(`${entry.hash.slice(0, 10)}…${entry.hash.slice(-6)}`)}</code>
      ${entry.status === "pending" ? `<span class="tx-hint">${escapeHtml(PENDING_TX_HINT)}</span>` : ""}
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

const menuRow = (view: WalletView, label: string, name: IconName): string =>
  `<button class="menu-row" data-view="${view}" type="button">
    <span class="menu-icon">${icon(name)}</span>
    <span class="menu-copy"><strong>${escapeHtml(label)}</strong></span>
    <span class="menu-chevron">${icon("chevronRight")}</span>
  </button>`;

const settingsScreen = (_status: WalletStatus, preferences: WalletPreferences | null): string =>
  dockScreen(
    "settings",
    `<h2>Settings</h2>
    <div class="menu-list" role="group" aria-label="Wallet settings">
      ${menuRow("network", "Network", "globe")}
      ${menuRow("account", "Account", "wallet")}
      ${menuRow("address-book", "Address book", "book")}
      ${menuRow("connected-sites", "Connected sites", "link")}
      ${menuRow("allowances", "Allowances", "lock")}
      ${menuRow("backup", "Backup & restore", "receive")}
      ${menuRow("reveal", "Reveal secrets", "lock")}
    </div>
    <p class="eyebrow">Appearance</p>
    <div class="option-list" role="group" aria-label="Theme">
      ${(["dark", "light"] as const)
        .map(
          (
            theme,
          ) => `<button class="option-row" data-theme-id="${theme}" type="button" aria-pressed="${(preferences?.theme ?? "dark") === theme}">
            <span class="option-copy"><strong>${theme === "light" ? "Light" : "Dark"}</strong></span>
            ${(preferences?.theme ?? "dark") === theme ? `<span class="option-mark">${icon("check")}</span>` : ""}
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
  allowances: readonly AllowanceRecord[] = [],
  selectedNftId: string | null = null,
  changes: Readonly<Record<string, number>> = {},
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
    return accountFlow(status, account, preferences);
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
  if (activeView === "nfts") {
    return nftGalleryFlow(status, account, preferences);
  }
  if (activeView === "nft-detail") {
    return nftDetailFlow(status, account, preferences, selectedNftId);
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
          );
  return `
    ${walletHeader(status, account, preferences)}
    ${screen}
    ${walletDock(activeView, pending.length)}`;
};
