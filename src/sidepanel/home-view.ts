/**
 * Home portfolio composition: public/private totals, primary actions, and the
 * token/collectible tabs. Kept separate from the screen router so adding a
 * portfolio state cannot push routing back over the repository size limit.
 */
import type { DiscoveredNft, WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { DisplayCurrency, WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { formatFiat, portfolioDelta, portfolioTotal } from "./fiat";
import { homeTabs, visibleHomeBalances, visiblePrivateHomeBalances } from "./home-tabs";
import { icon } from "./icons";
import { dockScreen, noAccountEmpty } from "./parts";
import type { PrivacyDisclosureState } from "./privacy-model";
import type { BalanceState } from "./runtime";
import {
  actionTile,
  deployNotice,
  pendingCallout,
  terminalCta,
  terminalPortfolioTile,
} from "./wallet-shell";

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

const heroPriceNotice = (priceStale: boolean, hasPrices: boolean): string =>
  priceStale && !hasPrices
    ? `<p class="hero-stale" role="status">${icon("alert")}<span>Live prices unavailable right now</span></p>`
    : "";

/**
 * Renders the account-scoped Home portfolio without the shared wallet shell.
 */
export const homeScreen = (
  status: WalletStatus,
  account: AccountRef | null,
  balances: BalanceState,
  pendingCount: number,
  deployment: boolean | null,
  preferences: WalletPreferences | null,
  prices: Readonly<Record<string, number>>,
  changes: Readonly<Record<string, number>>,
  currency: DisplayCurrency,
  priceStale: boolean,
  discoveredNfts: readonly DiscoveredNft[],
  privacy: PrivacyDisclosureState,
): string => {
  const privateBalances = visiblePrivateHomeBalances(privacy, preferences);
  const selectedBalances = privacy.enabled
    ? privateBalances
    : visibleHomeBalances(balances, preferences);
  const privateReady =
    privacy.value?.registration === "registered" && !privacy.loading && !privacy.error;
  const showTotal =
    account !== null && Object.keys(prices).length > 0 && (!privacy.enabled || privateReady);
  const total = showTotal ? portfolioTotal(selectedBalances, prices) : 0;
  return dockScreen(
    "home",
    `${pendingCallout(pendingCount)}
    <section class="hero">
      <p class="hero-total" data-live-key="${privacy.enabled ? "private-portfolio-total" : "portfolio-total"}" data-live-value="${showTotal ? total : "unknown"}">${showTotal ? escapeHtml(formatFiat(total, currency)) : "—"}</p>
      ${showTotal && !privacy.enabled ? heroDelta(balances, preferences, prices, changes, currency) : ""}
      ${privacy.enabled ? `<p class="hero-stale">${icon("lock")}<span>Private portfolio</span></p>` : ""}
      ${account !== null ? heroPriceNotice(priceStale, showTotal) : ""}
      ${account ? "" : noAccountEmpty(status)}
      ${deployNotice(account, deployment)}
    </section>
    <section class="home-actions" aria-label="Wallet actions">
      <div class="action-row">
        ${actionTile("send", "Send", "send", account !== null)}
        ${actionTile("swap", "Swap", "shuffle", account !== null)}
        ${actionTile("receive", "Receive", "qrCode", account !== null)}
        ${terminalPortfolioTile()}
      </div>
      ${terminalCta()}
    </section>
    ${homeTabs(balances, preferences, prices, changes, currency, status, discoveredNfts, privacy)}`,
  );
};
