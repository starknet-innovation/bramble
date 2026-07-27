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
import type { ClassHashVerification } from "../starknet/class-hash-verify";
import type { ActivityEntry } from "../storage/activity-store";
import type { MultisigProposalRecord, MultisigRecord } from "../storage/multisig-store";
import type { DisplayCurrency, WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { emptyState, pill } from "../ui/content";
import { iconButton, segmentedControl } from "../ui/controls";
import { selectField } from "../ui/fields";
import { menuLink } from "../ui/navigation";
import { accountDrawer } from "./account-drawer";
import { approvalCard } from "./approval-cards";
import { actionableApprovals, approvalTakeover } from "./approval-screen";
import { formatFiat, portfolioDelta, portfolioTotal } from "./fiat";
import { backupFlow, simpleFlowScreen } from "./flows";
import { activityEmptyCopy, homeTabs, transactionRow, visibleHomeBalances } from "./home-tabs";
import { icon } from "./icons";
import {
  multisigDeployFlow,
  multisigDetailFlow,
  multisigProposeFlow,
  multisigsFlow,
} from "./multisig-views";
import { nftDetailFlow, nftGalleryFlow } from "./nft-views";
import {
  accountLabel,
  activeAccount,
  dockScreen,
  isWalletView,
  noAccountEmpty,
  WALLET_VIEWS,
  type WalletView,
  walletMenuRow,
} from "./parts";
import { revealFlow } from "./reveal-ui";
import type { BalanceState } from "./runtime";
import { DEFAULT_CURRENCY, tokenDetailFlow, tokensFlow } from "./token-flows";
import { actionTile, deployNotice, pendingCallout, walletDock, walletHeader } from "./wallet-shell";

/**
 * Re-exported screen contract so entrypoints and tests import one module.
 */
export { isWalletView, WALLET_VIEWS, type WalletView };

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

// A degraded-mode notice under the hero total. Saved prices continue to render
// without an error-like caveat; only a genuinely empty cache needs an explicit
// unavailable hint.
const heroPriceNotice = (priceStale: boolean, hasPrices: boolean): string => {
  if (!priceStale || hasPrices) {
    return "";
  }
  return `<p class="hero-stale" role="status">${icon("alert")}<span>Live prices unavailable right now</span></p>`;
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
  historyUnavailable: boolean,
  discoveredNfts: readonly DiscoveredNft[],
): string => {
  const nfts = discoveredNfts;
  const showTotal = account !== null && Object.keys(prices).length > 0;
  const total = showTotal ? portfolioTotal(visibleHomeBalances(balances, preferences), prices) : 0;
  return dockScreen(
    "home",
    `${pendingCallout(pendingCount)}
    <section class="hero">
      <p class="hero-eyebrow">Total balance</p>
      <p class="hero-total" data-live-key="portfolio-total" data-live-value="${showTotal ? total : "unknown"}">${showTotal ? escapeHtml(formatFiat(total, currency)) : "—"}</p>
      ${showTotal ? heroDelta(balances, preferences, prices, changes, currency) : ""}
      ${account !== null ? heroPriceNotice(priceStale, showTotal) : ""}
      ${
        account
          ? `<button class="hero-chip" data-copy="${escapeHtml(account.address)}" type="button" title="Copy address">${escapeHtml(accountLabel(account.address))}${icon("copy")}</button>`
          : noAccountEmpty(status)
      }
      ${deployNotice(account, deployment)}
    </section>
    <div class="action-row">
      ${actionTile("send", "Send", "send", true, account !== null)}
      ${actionTile("swap", "Swap", "swap", false, account !== null)}
      ${actionTile("receive", "Receive", "receive", false, account !== null)}
    </div>
    ${homeTabs(balances, preferences, prices, changes, currency, transactions, status, historyUnavailable, nfts)}`,
  );
};

// The degraded indicator shown when on-chain history could not be reached, so an
// empty or short local-only feed never reads as the account's full history.
// Mirrors the offline-fiat "stale" notice: state the limitation and the action.
const HISTORY_UNAVAILABLE_NOTICE =
  "Couldn't load on-chain history. Showing transactions recorded on this device only — check your connection or RPC endpoint and refresh.";

const activityScreen = (
  pending: readonly PendingApproval[],
  status: WalletStatus,
  transactions: readonly ActivityEntry[],
  historyUnavailable: boolean,
): string =>
  dockScreen(
    "activity",
    `<section class="section">
      <div class="row"><h2>Requests</h2>${pill(`${pending.length} pending`)}</div>
      ${
        pending.length === 0
          ? emptyState("Nothing waiting on you. Connection requests from sites appear here.")
          : `<ul class="request-list">${pending.map((approval) => approvalCard(approval, status)).join("")}</ul>`
      }
      <p id="approval-result" role="status"></p>
    </section>
    <section class="section">
      <div class="row">
        <h2>Transactions</h2>
        <div class="header-actions">
          ${iconButton({
            attributes: { id: "activity-export" },
            disabled: transactions.length === 0,
            icon: "receive",
            label: "Export CSV",
          })}
          ${iconButton({
            attributes: { id: "activity-refresh" },
            icon: "refresh",
            label: "Refresh transactions",
          })}
        </div>
      </div>
      ${historyUnavailable ? emptyState(HISTORY_UNAVAILABLE_NOTICE, "status") : ""}
      ${
        transactions.length === 0
          ? emptyState(activityEmptyCopy(historyUnavailable))
          : `<ul class="tx-list">${transactions.map(transactionRow).join("")}</ul>`
      }
      <p id="activity-result" role="status"></p>
    </section>`,
  );

// The settings hub is a scannable map of the wallet, not a pile of buttons:
// personal preferences lead as compact controls (theme segments, currency),
// then destinations grouped by intent — Wallet (what you hold and where),
// Connections (what the outside world can touch), Security (what protects
// you) — each an inset grouped list with one-line rows. Rows carry their
// current value where one exists (network) so the screen answers questions
// before it is tapped. Theme is a two-way pin: Dark (default) or Light; a
// legacy stored "system" value reads as Dark, matching the entrypoint.
const settingsScreen = (status: WalletStatus, preferences: WalletPreferences | null): string =>
  dockScreen(
    "settings",
    `<h2>Settings</h2>
    <section class="section">
      <p class="eyebrow">Preferences</p>
      ${segmentedControl(
        "Theme",
        (["dark", "light"] as const).map((theme) => ({
          attributes: { "data-theme-id": theme },
          label: theme === "light" ? "Light" : "Dark",
          pressed: (preferences?.theme === "light" ? "light" : "dark") === theme,
        })),
      )}
      ${selectField({
        attributes: { id: "currency-select" },
        label: "Display currency",
        name: "displayCurrency",
        options: (["usd", "eur", "gbp"] as const).map((currency) => ({
          label: currency.toUpperCase(),
          value: currency,
        })),
        selected: preferences?.displayCurrency ?? "usd",
      })}
      <div class="stack">
        <span>Open wallet requests in</span>
        ${segmentedControl(
          "Wallet request surface",
          (["side-panel", "popup"] as const).map((surface) => ({
            attributes: { "data-approval-surface": surface },
            label: surface === "side-panel" ? "Side panel" : "Toolbar popup",
            pressed: (preferences?.approvalSurface ?? "side-panel") === surface,
          })),
        )}
      </div>
    </section>
    <section class="section">
      <p class="eyebrow">Wallet</p>
      <div class="menu-list" role="group" aria-label="Wallet">
        ${walletMenuRow("network", "Network", "globe", status.network)}
        ${walletMenuRow("account", "Accounts & groups", "wallet")}
        ${walletMenuRow("address-book", "Address book", "book")}
      </div>
    </section>
    <section class="section">
      <p class="eyebrow">Connections</p>
      <div class="menu-list" role="group" aria-label="Connections">
        ${walletMenuRow("connected-sites", "Connected sites", "link")}
        ${walletMenuRow("allowances", "Allowances", "coins")}
        ${walletMenuRow("multisigs", "Multisigs", "users")}
      </div>
    </section>
    <section class="section">
      <p class="eyebrow">Security</p>
      <div class="menu-list" role="group" aria-label="Security">
        ${walletMenuRow("backup", "Backup & restore", "shield")}
        ${walletMenuRow("reveal", "Reveal secrets", "lock")}
      </div>
    </section>
    <section class="section">
      <div class="menu-list">
        ${menuLink({
          href: "https://github.com/mc-wallet/mc-wallet#readme",
          icon: "book",
          label: "Help & docs",
          target: "_blank",
        })}
      </div>
    </section>
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
  _priceAsOf: number | null = null,
  discoveredNfts: readonly DiscoveredNft[] = [],
  openAssignId: string | null = null,
  classHashVerification: ClassHashVerification | null = null,
  historyUnavailable = false,
  snoozedApprovalIds: readonly string[] = [],
  multisigsError = false,
  multisigSync: "current" | "error" | null = null,
): string => {
  const account = activeAccount(status);
  const currency = preferences?.displayCurrency ?? DEFAULT_CURRENCY;
  const trackedBalances = "balances" in balances ? balances.balances : [];
  // A fresh external request always becomes the wallet's foreground task,
  // regardless of which dock or flow screen was previously open. The user may
  // explicitly snooze it back to Activity after seeing it.
  const actionable = actionableApprovals(pending, snoozedApprovalIds);
  if (actionable.length > 0) {
    return approvalTakeover(actionable, status);
  }
  const simpleFlow = simpleFlowScreen(activeView, {
    account,
    allowances,
    classHashVerification,
    connectedSites,
    expandedGroupId,
    preferences,
    status,
  });
  if (simpleFlow !== null) {
    return simpleFlow;
  }
  if (activeView === "multisigs") {
    return multisigsFlow(
      status,
      account,
      multisigs,
      multisigProposals,
      multisigsError,
      multisigSync,
    );
  }
  if (activeView === "multisig-detail" || activeView === "multisig-propose") {
    const selected = multisigs.find(
      (record) => record.id === selectedMultisigId && record.networkId === status.networkId,
    );
    return activeView === "multisig-detail"
      ? multisigDetailFlow(
          status,
          account,
          selected ?? null,
          multisigProposals,
          multisigsError,
          multisigSync,
        )
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
      ? activityScreen(pending, status, transactions, historyUnavailable)
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
            historyUnavailable,
            discoveredNfts,
          );
  return `
    ${walletHeader(status, account, preferences)}
    ${screen}
    ${walletDock(activeView, pending.length)}
    ${accountDrawer(status, account, preferences, drawerGroupFilter, openAssignId)}`;
};
