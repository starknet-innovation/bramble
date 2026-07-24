/**
 * Tabbed portfolio section on the home screen: Tokens, Collectibles, and
 * Activity share one section with a sliding accent indicator and per-tab
 * trailing actions. All three panels render up front so switching tabs never
 * re-renders the shell — the runtime just toggles visibility. Pure templates;
 * bindings live in ./home-ui.ts, styles in ./styles-home.ts.
 */
import type { DiscoveredNft, TokenBalance, WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { friendlyNetworkError } from "../shared/network-error";
import type { ActivityEntry } from "../storage/activity-store";
import type { DisplayCurrency, TokenConfig, WalletPreferences } from "../storage/preferences-store";
import { icon } from "./icons";
import { type NftGalleryItem, nftImageMarkup, visibleNftItems } from "./nft-views";
import type { BalanceState } from "./runtime";
import { isHiddenFromHome } from "./token-flows";
import { balanceRow } from "./token-row";

/**
 * Tab ids of the home portfolio section, in display order.
 */
const HOME_TABS = ["tokens", "collectibles", "activity"] as const;

/**
 * One of the home portfolio tabs.
 */
export type HomeTab = (typeof HOME_TABS)[number];

const TAB_LABELS: Readonly<Record<HomeTab, string>> = {
  activity: "Activity",
  collectibles: "Collectibles",
  tokens: "Tokens",
};

/**
 * Checks untrusted dataset values before switching home tabs.
 */
export const isHomeTab = (value: unknown): value is HomeTab =>
  typeof value === "string" && HOME_TABS.some((tab) => tab === value);

/**
 * Balances shown on the home Tokens tab: tracked balances minus user-hidden
 * and likely-spam tokens.
 */
export const visibleHomeBalances = (
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

/**
 * User guidance for pending Starknet transactions, shared with the activity
 * screen.
 */
const PENDING_TX_HINT =
  "Starknet has no fee-bump or replace-by-fee: a pending transaction can't be sped up, replaced, or cancelled. This is a protocol limitation, not a wallet one, and it usually settles within a few minutes.";

/**
 * Renders one recorded transaction row, shared by the home Activity tab and
 * the activity dock screen.
 */
export const transactionRow = (entry: ActivityEntry): string => `
  <li class="tx-row">
    <div class="tx-copy">
      <strong>${escapeHtml(entry.summary)}</strong>
      <code>${escapeHtml(`${entry.hash.slice(0, 10)}…${entry.hash.slice(-6)}`)}</code>
      ${entry.status === "pending" ? `<span class="tx-hint">${escapeHtml(PENDING_TX_HINT)}</span>` : ""}
    </div>
    <span class="tx-status ${entry.status}" data-live-key="transaction:${escapeHtml(entry.hash)}:status" data-live-value="${escapeHtml(entry.status)}"${entry.status === "pending" ? ` title="${escapeHtml(PENDING_TX_HINT)}"` : ""}>${escapeHtml(entry.status)}</span>
    <button class="icon-button" data-copy="${escapeHtml(entry.hash)}" type="button" aria-label="Copy transaction hash" title="Copy transaction hash">${icon("copy")}</button>
  </li>`;

// Renders the failed-load state with a friendly, actionable line and an
// in-panel retry that re-runs the balance load (wired in ./index.ts).
const tokensErrorPanel = (error: string): string => `
  <div class="panel-error">
    <p class="empty">${escapeHtml(friendlyNetworkError(error) ?? error)}</p>
    <button class="ghost small" data-reload-balances type="button" aria-label="Retry loading balances">${icon("refresh")}Try again</button>
  </div>`;

const tokensPanel = (
  state: BalanceState,
  preferences: WalletPreferences | null,
  prices: Readonly<Record<string, number>>,
  changes: Readonly<Record<string, number>>,
  currency: DisplayCurrency,
): string => {
  const visible = visibleHomeBalances(state, preferences);
  const hiddenCount = "error" in state ? 0 : state.balances.length - visible.length;
  return `${
    "error" in state
      ? tokensErrorPanel(state.error)
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
    <p id="panel-result" role="status"></p>`;
};

const collectibleCard = (nft: NftGalleryItem, eager: boolean): string => `
  <li>
    <button class="collectible-card" data-nft-open="${escapeHtml(nft.id)}" type="button">
      <span class="collectible-art">${nftImageMarkup(nft, true, eager)}${icon("image")}</span>
      <span class="collectible-copy">
        <strong>${escapeHtml(nft.title)}</strong>
        <code>#${escapeHtml(nft.tokenId)}</code>
      </span>
    </button>
  </li>`;

const collectiblesPanel = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
  discoveredNfts: readonly DiscoveredNft[],
): string => {
  const nfts = visibleNftItems(preferences?.nfts ?? [], discoveredNfts, status.networkId).filter(
    (nft) => nft.watched,
  );
  return `${
    nfts.length === 0
      ? '<p class="empty">No collectibles watched on this network yet. Add one you own from the gallery.</p>'
      : `<ul class="collectible-grid">${nfts.map((nft, index) => collectibleCard(nft, index < 4)).join("")}</ul>`
  }
    <button class="ghost small tab-more" data-view="nfts" type="button">Open gallery${icon("chevronRight")}</button>`;
};

const RECENT_ACTIVITY_LIMIT = 5;

// Compact degraded line for the home Activity tab when on-chain history could
// not be reached; the full explanation lives on the Activity dock screen.
const HISTORY_UNAVAILABLE_HINT =
  "On-chain history unavailable — showing this device's records only.";

/**
 * Empty-state copy for the merged activity feed, shared by the home Activity
 * tab and the Activity dock screen so the two surfaces can never drift. When
 * on-chain history is unavailable the feed can only be this device's records;
 * otherwise it is the merged local + on-chain feed.
 */
export const activityEmptyCopy = (historyUnavailable: boolean): string =>
  historyUnavailable
    ? "No transactions recorded on this device yet."
    : "No activity yet. On-chain transactions for this account, and transactions you submit from this wallet, appear here.";

const activityPanel = (
  transactions: readonly ActivityEntry[],
  historyUnavailable: boolean,
): string => {
  const recent = transactions.slice(0, RECENT_ACTIVITY_LIMIT);
  return `${historyUnavailable ? `<p class="empty" role="status">${escapeHtml(HISTORY_UNAVAILABLE_HINT)}</p>` : ""}
    ${
      recent.length === 0
        ? `<p class="empty">${escapeHtml(activityEmptyCopy(historyUnavailable))}</p>`
        : `<ul class="tx-list">${recent.map(transactionRow).join("")}</ul>`
    }
    ${
      transactions.length > 0
        ? `<button class="ghost small tab-more" data-view="activity" type="button">View all activity${icon("chevronRight")}</button>`
        : ""
    }`;
};

const tabButton = (tab: HomeTab): string =>
  `<button class="home-tab" id="home-tab-${tab}" data-home-tab="${tab}" type="button" role="tab" aria-selected="${tab === "tokens"}" aria-controls="home-panel-${tab}">${TAB_LABELS[tab]}</button>`;

const tabPanel = (tab: HomeTab, body: string): string =>
  `<div class="tab-panel" id="home-panel-${tab}" data-tab-panel="${tab}" role="tabpanel" aria-labelledby="home-tab-${tab}"${tab === "tokens" ? "" : " hidden"}>${body}</div>`;

/**
 * Renders the tabbed portfolio section. The Tokens tab opens by default; the
 * runtime re-applies the remembered tab after every re-render.
 */
export const homeTabs = (
  state: BalanceState,
  preferences: WalletPreferences | null,
  prices: Readonly<Record<string, number>>,
  changes: Readonly<Record<string, number>>,
  currency: DisplayCurrency,
  transactions: readonly ActivityEntry[],
  status: WalletStatus,
  historyUnavailable: boolean,
  discoveredNfts: readonly DiscoveredNft[] = [],
): string => `
  <section class="home-tabs" data-active-tab="tokens" aria-label="Portfolio">
    <div class="tab-bar">
      <div class="tab-set" role="tablist" aria-label="Portfolio sections">
        ${HOME_TABS.map(tabButton).join("")}
        <span class="tab-indicator" aria-hidden="true"></span>
      </div>
      <div class="tab-actions" data-tab-actions="tokens">
        <button class="icon-button ghost" data-view="tokens" type="button" aria-label="Manage tokens" title="Manage tokens">${icon("plus")}</button>
        <button id="refresh-button" class="icon-button ghost" data-reload-balances type="button" aria-label="Refresh balances" title="Refresh balances">${icon("refresh")}</button>
      </div>
      <div class="tab-actions" data-tab-actions="collectibles" hidden>
        <button class="icon-button ghost" data-view="nfts" type="button" aria-label="Manage collectibles" title="Manage collectibles">${icon("plus")}</button>
      </div>
      <div class="tab-actions" data-tab-actions="activity" hidden>
        <button class="icon-button ghost" data-view="activity" type="button" aria-label="Open full activity" title="Open full activity">${icon("activity")}</button>
      </div>
    </div>
    ${tabPanel("tokens", tokensPanel(state, preferences, prices, changes, currency))}
    ${tabPanel("collectibles", collectiblesPanel(status, preferences, discoveredNfts))}
    ${tabPanel("activity", activityPanel(transactions, historyUnavailable))}
  </section>`;
