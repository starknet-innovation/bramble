/**
 * Tabbed portfolio section on the home screen: Tokens and Collectibles share
 * one immediate local switcher. Activity remains a top-level dock destination
 * rather than appearing twice. A single overflow menu progressively discloses
 * asset management, refresh, and settings actions.
 */
import type { DiscoveredNft, TokenBalance, WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { friendlyNetworkError } from "../shared/network-error";
import { explorerTransactionUrl } from "../starknet/networks";
import { formatTokenAmount } from "../starknet/rpc";
import type { ActivityEntry } from "../storage/activity-store";
import type { DisplayCurrency, TokenConfig, WalletPreferences } from "../storage/preferences-store";
import { emptyState } from "../ui/content";
import { button, iconButton, iconLink } from "../ui/controls";
import { menuRow } from "../ui/navigation";
import { icon } from "./icons";
import { type NftGalleryItem, nftImageMarkup, nftTilePlay, visibleNftItems } from "./nft-views";
import type { PrivacyDisclosureState } from "./privacy-model";
import type { BalanceState } from "./runtime";
import { compareStrkFirst, isHiddenFromHome } from "./token-flows";
import { type PrivateBreakdown, unifiedBalanceRow } from "./token-row";

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
  if (privacy.loading || privacy.error || privacy.value?.registration !== "registered") {
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
 * Home token list with public and private balances summed per asset. Rows keep
 * the public token order; tokens holding only a private balance are appended.
 * When discovery has not produced private amounts the list equals the public
 * one, so hero totals degrade to public-only instead of hiding.
 */
export const unifiedHomeBalances = (
  state: BalanceState,
  privacy: PrivacyDisclosureState,
  preferences: WalletPreferences | null,
): readonly TokenBalance[] => {
  const privateById = new Map(
    visiblePrivateHomeBalances(privacy, preferences).map((token) => [token.id, token]),
  );
  const combined = visibleHomeBalances(state, preferences).map((token) => {
    const privateEntry = privateById.get(token.id);
    privateById.delete(token.id);
    if (!privateEntry) {
      return token;
    }
    const total = BigInt(token.balance) + BigInt(privateEntry.balance);
    return {
      ...token,
      balance: `0x${total.toString(16)}`,
      formatted: formatTokenAmount(total, token.decimals),
    };
  });
  return [...combined, ...privateById.values()].sort(compareStrkFirst);
};

/**
 * User guidance for transactions Starknet has not settled yet, shared with the
 * activity screen. Pending and pre-confirmed are both provisional, but they say
 * different things: pending means the chain has not executed the transaction,
 * pre-confirmed means the proposer has executed it and consensus has not
 * committed its block yet.
 */
const PROVISIONAL_TX_HINT: Partial<Record<ActivityEntry["status"], string>> = {
  pending:
    "Broadcast accepted. Starknet normally confirms quickly, and this wallet checks immediately. A pending transaction can't be fee-bumped, replaced, or cancelled.",
  preconfirmed:
    "Pre-confirmed by the block proposer, so the result is known but not yet final. MC Wallet keeps checking in the background and will tell you if it does not settle.",
};

/**
 * Display label for a status. Pre-confirmed reads as "PRE-CONFIRMED" rather
 * than the storage spelling.
 */
const STATUS_LABEL: Partial<Record<ActivityEntry["status"], string>> = {
  preconfirmed: "pre-confirmed",
};

/**
 * Renders one recorded transaction row for the account-partitioned Activity
 * dock and its design-system specimen. A provisional status carries an
 * explanatory hint and its own muted-but-distinct treatment, so a pre-confirmed
 * transaction never reads as settled.
 */
export const transactionRow = (entry: ActivityEntry): string => {
  const hint = PROVISIONAL_TX_HINT[entry.status];
  const label = STATUS_LABEL[entry.status] ?? entry.status;
  // Devnet has no explorer, so the outbound link is simply absent there rather
  // than pointing somewhere that cannot resolve the hash.
  const explorer = explorerTransactionUrl(entry.networkId, entry.hash);
  return `
  <li class="tx-row">
    <div class="tx-copy">
      <strong>${escapeHtml(entry.summary)}</strong>
      <code>${escapeHtml(`${entry.hash.slice(0, 10)}…${entry.hash.slice(-6)}`)}</code>
      ${hint ? `<span class="tx-hint">${escapeHtml(hint)}</span>` : ""}
    </div>
    <span class="tx-status ${entry.status}" data-live-key="transaction:${escapeHtml(entry.hash)}:status" data-live-value="${escapeHtml(entry.status)}"${hint ? ` title="${escapeHtml(hint)}"` : ""}>${escapeHtml(label)}</span>
    ${iconButton({
      attributes: { "data-copy": entry.hash },
      icon: "copy",
      label: "Copy transaction hash",
    })}
    ${
      explorer
        ? iconLink({
            attributes: { "data-tx-explorer": entry.hash },
            href: explorer,
            icon: "externalLink",
            label: "View transaction on Starkscan",
            target: "_blank",
            variant: "ghost",
          })
        : ""
    }
  </li>`;
};

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

// Derives one asset's private-line state from the shared discovery state. An
// idle discovery (auto-load not finished) reads as loading, never as absent.
const privateBreakdownFor = (
  privacy: PrivacyDisclosureState,
  tokenId: string,
): PrivateBreakdown => {
  if (privacy.error) {
    return { kind: "unavailable", message: privacy.error };
  }
  if (privacy.loading || !privacy.value) {
    return { kind: "loading" };
  }
  if (privacy.value.privateBalances === "setup-required") {
    return { kind: "setup-required" };
  }
  if (privacy.value.registration === "pending") {
    return { kind: "pending" };
  }
  if (privacy.value.registration !== "registered") {
    return { kind: "unregistered" };
  }
  const entry = privacy.value.balances.find((candidate) => candidate.tokenId === tokenId);
  return {
    balance: entry?.balance ?? "0x0",
    formatted: entry?.formatted ?? "0",
    kind: "ready",
  };
};

const privacyErrorLine = (privacy: PrivacyDisclosureState): string =>
  privacy.error
    ? `<div class="privacy-inline-error" role="alert"><span>Shielded balances unavailable right now.</span>${button(
        {
          attributes: { "data-privacy-retry": true },
          label: "Try again",
          size: "small",
          variant: "ghost",
        },
      )}</div>`
    : "";

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
  const publicById = new Map(visible.map((token) => [token.id, token]));
  const unified = unifiedHomeBalances(state, privacy, preferences);
  const body =
    "error" in state
      ? tokensErrorPanel(state.error)
      : unified.length === 0
        ? emptyState("No tracked balances yet. Add or detect tokens to see them here.")
        : `<ul class="token-list">${unified
            .map((token) =>
              unifiedBalanceRow(token, prices[token.address], changes[token.address], currency, {
                private: privateBreakdownFor(privacy, token.id),
                publicFormatted: publicById.get(token.id)?.formatted ?? "0",
              }),
            )
            .join("")}</ul>`;
  return `${privacyErrorLine(privacy)}
    ${body}
    ${
      hiddenCount > 0
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

/**
 * Renders one compact collectible card for the home portfolio tab.
 */
export const collectibleCard = (nft: NftGalleryItem, eager: boolean): string => `
  <li class="collectible-tile">
    <button class="collectible-card" data-nft-open="${escapeHtml(nft.id)}" type="button">
      <span class="collectible-art">${nftImageMarkup(nft, true, eager)}${icon("image")}</span>
      <span class="collectible-copy">
        <strong>${escapeHtml(nft.title)}</strong>
        <code>#${escapeHtml(nft.tokenId)}</code>
      </span>
    </button>
    ${nftTilePlay(nft)}
  </li>`;

const collectiblesPanel = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
  discoveredNfts: readonly DiscoveredNft[],
): string => {
  const owner = status.accounts.find((account) => account.id === status.activeAccountId)?.address;
  const nfts = visibleNftItems(
    preferences?.nfts ?? [],
    discoveredNfts,
    status.networkId,
    owner ?? null,
  ).filter((nft) => nft.watched);
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
