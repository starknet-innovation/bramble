/**
 * Tabbed portfolio section on the home screen: Tokens and Collectibles share
 * one immediate local switcher. Activity remains a top-level dock destination
 * rather than appearing twice. A single overflow menu progressively discloses
 * asset management, refresh, and settings actions.
 */
import type { DiscoveredNft, TokenBalance, WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { friendlyNetworkError } from "../shared/network-error";
import type { ActivityEntry } from "../storage/activity-store";
import type { DisplayCurrency, TokenConfig, WalletPreferences } from "../storage/preferences-store";
import { emptyState } from "../ui/content";
import { button, iconButton } from "../ui/controls";
import { menuRow } from "../ui/navigation";
import { icon } from "./icons";
import { type NftGalleryItem, nftImageMarkup, visibleNftItems } from "./nft-views";
import type { PrivacyDisclosureState } from "./privacy-model";
import type { BalanceState } from "./runtime";
import { isHiddenFromHome } from "./token-flows";
import { balanceRow } from "./token-row";

/**
 * Tab ids of the home portfolio section, in display order.
 */
const HOME_TABS = ["tokens", "collectibles"] as const;

/**
 * One of the home portfolio tabs.
 */
export type HomeTab = (typeof HOME_TABS)[number];

const TAB_LABELS: Readonly<Record<HomeTab, string>> = {
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
 * Private balances shown on the home portfolio, using the same user-hidden and
 * spam filtering rules as the public token list.
 */
export const visiblePrivateHomeBalances = (
  privacy: PrivacyDisclosureState,
  preferences: WalletPreferences | null,
): readonly TokenBalance[] => {
  if (
    !privacy.enabled ||
    privacy.loading ||
    privacy.error ||
    privacy.value?.registration !== "registered"
  ) {
    return [];
  }
  const trackedById = new Map<string, TokenConfig>(
    (preferences?.tokens ?? []).map((token) => [token.id, token]),
  );
  return privacy.value.balances.flatMap((entry) => {
    const token = trackedById.get(entry.tokenId);
    return !token || isHiddenFromHome(token, preferences)
      ? []
      : [{ ...token, balance: entry.balance, formatted: entry.formatted }];
  });
};

/**
 * User guidance for pending Starknet transactions, shared with the activity
 * screen.
 */
const PENDING_TX_HINT =
  "Broadcast accepted. Starknet normally confirms quickly, and this wallet checks immediately. A pending transaction can't be fee-bumped, replaced, or cancelled.";

/**
 * Renders one recorded transaction row for the account-partitioned Activity
 * dock and its design-system specimen.
 */
export const transactionRow = (entry: ActivityEntry): string => `
  <li class="tx-row">
    <div class="tx-copy">
      <strong>${escapeHtml(entry.summary)}</strong>
      <code>${escapeHtml(`${entry.hash.slice(0, 10)}…${entry.hash.slice(-6)}`)}</code>
      ${entry.status === "pending" ? `<span class="tx-hint">${escapeHtml(PENDING_TX_HINT)}</span>` : ""}
    </div>
    <span class="tx-status ${entry.status}" data-live-key="transaction:${escapeHtml(entry.hash)}:status" data-live-value="${escapeHtml(entry.status)}"${entry.status === "pending" ? ` title="${escapeHtml(PENDING_TX_HINT)}"` : ""}>${escapeHtml(entry.status)}</span>
    ${iconButton({
      attributes: { "data-copy": entry.hash },
      icon: "copy",
      label: "Copy transaction hash",
    })}
  </li>`;

// Renders the failed-load state with a friendly, actionable line and an
// in-panel retry that re-runs the balance load (wired in ./index.ts).
const tokensErrorPanel = (error: string): string => `
  <div class="panel-error">
    ${emptyState(friendlyNetworkError(error) ?? error)}
    ${button({
      attributes: { "aria-label": "Retry loading balances", "data-reload-balances": true },
      icon: "refresh",
      label: "Try again",
      size: "small",
      variant: "ghost",
    })}
  </div>`;

const tokensPanel = (
  state: BalanceState,
  preferences: WalletPreferences | null,
  prices: Readonly<Record<string, number>>,
  changes: Readonly<Record<string, number>>,
  currency: DisplayCurrency,
  privacy: PrivacyDisclosureState,
): string => {
  const visible = visibleHomeBalances(state, preferences);
  const hiddenCount = "error" in state ? 0 : state.balances.length - visible.length;
  const publicBody =
    "error" in state
      ? tokensErrorPanel(state.error)
      : visible.length === 0
        ? emptyState("No tracked balances yet. Add or detect tokens to see them here.")
        : `<ul class="token-list">${visible
            .map((token) =>
              balanceRow(token, prices[token.address], changes[token.address], currency),
            )
            .join("")}</ul>`;
  const privateBody = privateBalancesPanel(privacy, preferences, prices, changes, currency);
  return `${privacyToggle(privacy)}
    ${privacy.enabled ? privateBody : publicBody}
    ${
      !privacy.enabled && hiddenCount > 0
        ? menuRow({
            attributes: { "data-view": "tokens" },
            icon: "coins",
            label: "Hidden tokens",
            value: `${hiddenCount} hidden`,
          })
        : ""
    }
    <p id="panel-result" role="status"></p>`;
};

const privacyToggle = (privacy: PrivacyDisclosureState): string => `
  <div class="privacy-toggle-row">
    <span class="privacy-toggle-copy">
      <strong>${privacy.enabled ? "Private balances" : "Public balances"}</strong>
      <span>${privacy.enabled ? "Visible only inside this wallet" : "Read directly from Starknet"}</span>
    </span>
    <button class="privacy-switch" data-privacy-toggle type="button" role="switch" aria-checked="${privacy.enabled}" aria-label="Show private balances"></button>
  </div>`;

const privateBalancesPanel = (
  privacy: PrivacyDisclosureState,
  preferences: WalletPreferences | null,
  prices: Readonly<Record<string, number>>,
  changes: Readonly<Record<string, number>>,
  currency: DisplayCurrency,
): string => {
  if (privacy.loading) {
    return `<div class="privacy-callout" role="status"><strong>Discovering private notes…</strong><p>Reading the privacy indexer for this account.</p></div>`;
  }
  if (privacy.error) {
    return `<div class="privacy-callout" role="alert"><strong>Private balances unavailable</strong><p>${escapeHtml(privacy.error)}</p>${button({ attributes: { "data-privacy-retry": true }, label: "Try again", size: "small", variant: "secondary" })}</div>`;
  }
  if (!privacy.value) {
    return `<div class="privacy-callout"><strong>Private balances are off</strong><p>Enable the toggle to discover shielded assets for this account.</p></div>`;
  }
  if (privacy.value.registration === "unregistered") {
    return `<div class="privacy-callout"><strong>Activate private balances</strong><p>Register this account with the privacy pool before shielding an asset.</p>${button({ attributes: { "data-privacy-register": true }, icon: "shield", label: "Review activation", size: "small" })}</div>`;
  }
  const rows = visiblePrivateHomeBalances(privacy, preferences).map((token) =>
    balanceRow(token, prices[token.address], changes[token.address], currency, { private: true }),
  );
  return rows.length > 0
    ? `<ul class="token-list">${rows.join("")}</ul>`
    : `<div class="privacy-callout"><strong>No private balances yet</strong><p>Open an asset and choose Go private to shield part of its public balance.</p></div>`;
};

/**
 * Renders one compact collectible card for the home portfolio tab.
 */
export const collectibleCard = (nft: NftGalleryItem, eager: boolean): string => `
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
      ? emptyState("No collectibles watched on this network yet. Add one you own from the gallery.")
      : `<ul class="collectible-grid">${nfts.map((nft, index) => collectibleCard(nft, index < 4)).join("")}</ul>`
  }
    ${button({
      attributes: { "data-view": "nfts" },
      className: "tab-more",
      icon: "chevronRight",
      iconPosition: "after",
      label: "Open gallery",
      size: "small",
      variant: "ghost",
    })}`;
};

/**
 * Empty-state copy for the account-partitioned Activity dock.
 */
export const activityEmptyCopy = (historyUnavailable: boolean): string =>
  historyUnavailable
    ? "No transactions recorded on this device yet."
    : "No activity yet. On-chain transactions for this account, and transactions you submit from this wallet, appear here.";

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
  status: WalletStatus,
  discoveredNfts: readonly DiscoveredNft[] = [],
  privacy: PrivacyDisclosureState = {
    enabled: false,
    error: null,
    loading: false,
    value: null,
  },
): string => `
  <section class="home-tabs" data-active-tab="tokens" aria-label="Portfolio">
    <div class="tab-bar">
      <div class="tab-set" role="tablist" aria-label="Portfolio sections">
        ${HOME_TABS.map(tabButton).join("")}
      </div>
      <div class="portfolio-actions">
        ${iconButton({
          attributes: {
            "aria-controls": "portfolio-menu",
            "aria-expanded": "false",
            "aria-haspopup": "menu",
            id: "portfolio-menu-trigger",
          },
          className: "portfolio-menu-trigger",
          icon: "moreHorizontal",
          label: "Portfolio actions",
          variant: "ghost",
        })}
        <div class="portfolio-menu" id="portfolio-menu" role="menu" aria-label="Portfolio actions" hidden>
          ${button({
            attributes: { "data-view": "tokens", role: "menuitem", tabindex: "-1" },
            className: "portfolio-menu-item",
            icon: "coins",
            label: "Manage tokens",
            variant: "ghost",
          })}
          ${button({
            attributes: { "data-view": "nfts", role: "menuitem", tabindex: "-1" },
            className: "portfolio-menu-item",
            icon: "image",
            label: "Manage collectibles",
            variant: "ghost",
          })}
          ${button({
            attributes: { "data-view": "settings", role: "menuitem", tabindex: "-1" },
            className: "portfolio-menu-item",
            icon: "settings",
            label: "Wallet settings",
            variant: "ghost",
          })}
          ${button({
            attributes: {
              "data-reload-balances": true,
              id: "refresh-button",
              role: "menuitem",
              tabindex: "-1",
            },
            className: "portfolio-menu-item",
            icon: "refresh",
            label: "Refresh portfolio",
            variant: "ghost",
          })}
        </div>
      </div>
    </div>
    ${tabPanel("tokens", tokensPanel(state, preferences, prices, changes, currency, privacy))}
    ${tabPanel("collectibles", collectiblesPanel(status, preferences, discoveredNfts))}
  </section>`;
