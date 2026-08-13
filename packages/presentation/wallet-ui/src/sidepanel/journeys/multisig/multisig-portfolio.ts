/**
 * Shared-account portfolio composition. Balances are scoped to the watched
 * multisig contract by the privileged background and never reuse the active
 * signer's cache.
 */

import { escapeHtml } from "@mc-wallet/core/html";
import type { ArgentMultisigRecord } from "@mc-wallet/multisig/repository";
import type { DisplayCurrency, WalletPreferences } from "@mc-wallet/settings/preferences";
import { emptyState } from "@mc-wallet/ui-kit/content";
import { button } from "@mc-wallet/ui-kit/controls";
import type { DiscoveredNft } from "../../../popup/responses/responses";
import type { BalanceState } from "../../runtime/runtime";
import { formatFiat, portfolioDelta, portfolioTotal } from "../../shared/fiat";
import { icon } from "../../shared/icons";
import { actionTile } from "../../shell/wallet-shell";
import { nftImageMarkup, visibleNftItems } from "../collectibles/nft-views";
import { visibleHomeBalances } from "../portfolio/home-tabs";
import { balanceRow } from "../portfolio/token-row";

/**
 * Public portfolio data resolved for one watched multisig address.
 */
export type MultisigPortfolioData = {
  readonly balances: BalanceState;
  readonly changes: Readonly<Record<string, number>>;
  readonly currency: DisplayCurrency;
  readonly nfts: readonly DiscoveredNft[] | null;
  readonly prices: Readonly<Record<string, number>>;
};

/**
 * Honest loading state used until the selected multisig's own balance request
 * returns. It renders no cached signer assets.
 */
export const EMPTY_MULTISIG_PORTFOLIO: MultisigPortfolioData = {
  balances: { error: "Shared balances are loading." },
  changes: {},
  currency: "usd",
  nfts: null,
  prices: {},
};

const portfolioHero = (
  record: ArgentMultisigRecord,
  preferences: WalletPreferences | null,
  data: MultisigPortfolioData,
): string => {
  const visible = visibleHomeBalances(data.balances, preferences);
  const hasPrices = visible.some((balance) => data.prices[balance.address] !== undefined);
  const total = hasPrices ? portfolioTotal(visible, data.prices) : null;
  const delta = hasPrices ? portfolioDelta(visible, data.prices, data.changes) : null;
  return `<section class="hero multisig-portfolio-hero" aria-label="Shared account balance">
    <p class="hero-total" data-live-key="multisig-total:${escapeHtml(record.id)}" data-live-value="${total ?? "unknown"}">${total === null ? "—" : escapeHtml(formatFiat(total, data.currency))}</p>
    ${
      delta
        ? `<p class="hero-change${delta.direction === "down" ? " down" : ""}">
            <span class="hero-change-amt">${delta.direction === "up" ? "↑" : "↓"} ${escapeHtml(formatFiat(delta.absolute, data.currency))}</span>
            <span class="hero-change-win">${delta.percent.toFixed(2)}% · 24h</span>
          </p>`
        : ""
    }
  </section>`;
};

const tokenPanel = (preferences: WalletPreferences | null, data: MultisigPortfolioData): string => {
  if ("error" in data.balances) {
    return `<div class="panel-error">
      ${emptyState("Shared balances are unavailable right now.")}
      ${button({
        attributes: { "data-multisig-portfolio-retry": true },
        icon: "refresh",
        label: "Try again",
        size: "small",
        variant: "ghost",
      })}
    </div>`;
  }
  const visible = visibleHomeBalances(data.balances, preferences);
  return visible.length === 0
    ? emptyState("No tracked token balances are held by this shared account.")
    : `<ul class="token-list">${visible
        .map((token) =>
          balanceRow(token, data.prices[token.address], data.changes[token.address], data.currency),
        )
        .join("")}</ul>`;
};

const collectiblesPanel = (
  record: ArgentMultisigRecord,
  preferences: WalletPreferences | null,
  data: MultisigPortfolioData,
): string => {
  if (data.nfts === null) {
    return emptyState("Shared collectibles are loading.");
  }
  const nfts = visibleNftItems(
    preferences?.nfts ?? [],
    data.nfts,
    record.networkId,
    record.address,
  );
  if (nfts.length === 0) {
    return emptyState("No collectibles found for this shared account.");
  }
  return `<ul class="collectible-grid">${nfts
    .map(
      (nft, index) => `<li>
        <article class="collectible-card shared-collectible-card">
          <span class="collectible-art">${nftImageMarkup(nft, nft.watched, index < 4)}${icon("image")}</span>
          <span class="collectible-copy">
            <strong>${escapeHtml(nft.title)}</strong>
            <code>#${escapeHtml(nft.tokenId)}</code>
          </span>
        </article>
      </li>`,
    )
    .join("")}</ul>`;
};

/**
 * Renders the familiar wallet-home hierarchy for one multisig: portfolio,
 * multisig-specific primary actions, then Tokens, Collectibles, and intents.
 */
export const multisigPortfolio = (input: {
  readonly canSign: boolean;
  readonly data: MultisigPortfolioData;
  readonly openCount: number;
  readonly preferences: WalletPreferences | null;
  readonly intents: string;
  readonly record: ArgentMultisigRecord;
}): string => `
  ${portfolioHero(input.record, input.preferences, input.data)}
  <section class="home-actions multisig-primary-actions" aria-label="Multisig actions">
    <div class="action-row">
      ${actionTile("multisig-propose", "Prepare", "plus", input.canSign)}
      ${actionTile("multisig-receive", "Receive", "qrCode", true)}
      ${actionTile("multisig-signers", "Signers", "users", true)}
      ${actionTile("multisig-track", "Import", "search", true)}
    </div>
    ${input.canSign ? "" : '<p class="hint">This wallet does not own a current signer, so it can watch this account but cannot propose actions.</p>'}
  </section>
  <section class="home-tabs multisig-portfolio-tabs" data-active-tab="assets" aria-label="Shared account">
    <div class="tab-bar">
      <div class="tab-set" role="tablist" aria-label="Shared account sections">
        <button class="home-tab" data-ms-home-tab="assets" type="button" role="tab" aria-selected="true">Tokens</button>
        <button class="home-tab" data-ms-home-tab="collectibles" type="button" role="tab" aria-selected="false">Collectibles</button>
        <button class="home-tab" data-ms-home-tab="intents" type="button" role="tab" aria-selected="false" aria-label="Signing intents, ${input.openCount} open">Intents${input.openCount > 0 ? `<span class="home-tab-count">${input.openCount}</span>` : ""}</button>
      </div>
    </div>
    <div data-ms-home-panel="assets" role="tabpanel">${tokenPanel(input.preferences, input.data)}</div>
    <div data-ms-home-panel="collectibles" role="tabpanel" hidden>${collectiblesPanel(input.record, input.preferences, input.data)}</div>
    <div data-ms-home-panel="intents" role="tabpanel" hidden>${input.intents}</div>
  </section>`;
