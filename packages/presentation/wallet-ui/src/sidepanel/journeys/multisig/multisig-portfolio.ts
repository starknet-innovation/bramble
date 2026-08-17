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
import { explorerAccountUrl } from "@mc-wallet/wallet-model/networks";
import type { DiscoveredNft } from "../../../popup/responses/responses";
import type { BalanceState } from "../../runtime/runtime";
import { formatFiat, portfolioDelta, portfolioTotal } from "../../shared/fiat";
import { icon } from "../../shared/icons";
import { actionTile, explorerTile } from "../../shell/wallet-shell";
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
  return `<section class="hero multisig-portfolio-hero" aria-label="Shared account balance" data-live-group>
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
  readonly authorityAvailable: boolean;
  readonly canSign: boolean;
  readonly data: MultisigPortfolioData;
  readonly deployed?: boolean | null;
  readonly openCount: number;
  readonly preferences: WalletPreferences | null;
  readonly intents: string;
  readonly record: ArgentMultisigRecord;
  readonly signerKnown: boolean;
}): string => `
  ${portfolioHero(input.record, input.preferences, input.data)}
  <section class="home-actions multisig-primary-actions" aria-label="Multisig actions">
    <div class="action-row">
      ${input.deployed === false ? actionTile("multisig-deploy", "Deploy", "wallet", true) : actionTile("multisig-propose", "Prepare", "plus", input.canSign)}
      ${actionTile("multisig-receive", "Receive", "qrCode", true)}
      ${actionTile("multisig-signers", "Signers", "users", true)}
      ${explorerTile(explorerAccountUrl(input.record.networkId, input.record.address))}
    </div>
    ${
      input.deployed === false
        ? input.record.deployment
          ? '<p class="hint multisig-action-note"><strong>Deployment required.</strong> Deploy this saved account on Starknet before preparing a transaction.</p>'
          : '<p class="hint multisig-action-note"><strong>Deployment required.</strong> Open Deploy and enter the original signer set, threshold, and salt; review will verify this address.</p>'
        : !input.authorityAvailable
          ? '<p class="hint multisig-action-note">Deployment and signer authority could not be verified. Retry when network access is restored.</p>'
          : input.canSign
            ? ""
            : input.signerKnown
              ? '<p class="hint multisig-action-note"><strong>Signer found.</strong> This account is synced, but preparing transactions requires its complete signer setup.</p>'
              : '<p class="hint multisig-action-note">This wallet does not own a current signer, so it can watch this account but cannot propose actions.</p>'
    }
  </section>
  <section class="home-tabs multisig-portfolio-tabs" data-active-tab="assets" aria-label="Shared account">
    <div class="tab-bar">
      <div class="tab-set" role="tablist" aria-label="Shared account sections">
        <button class="home-tab" id="multisig-tab-assets" data-ms-home-tab="assets" type="button" role="tab" aria-controls="multisig-panel-assets" aria-selected="true" tabindex="0">Tokens</button>
        <button class="home-tab" id="multisig-tab-collectibles" data-ms-home-tab="collectibles" type="button" role="tab" aria-controls="multisig-panel-collectibles" aria-selected="false" tabindex="-1">Collectibles</button>
        <button class="home-tab" id="multisig-tab-intents" data-ms-home-tab="intents" type="button" role="tab" aria-controls="multisig-panel-intents" aria-selected="false" aria-label="Signing intents, ${input.openCount} open" tabindex="-1">Intents${input.openCount > 0 ? `<span class="home-tab-count">${input.openCount}</span>` : ""}</button>
      </div>
    </div>
    <div id="multisig-panel-assets" data-ms-home-panel="assets" role="tabpanel" aria-labelledby="multisig-tab-assets" tabindex="0">${tokenPanel(input.preferences, input.data)}</div>
    <div id="multisig-panel-collectibles" data-ms-home-panel="collectibles" role="tabpanel" aria-labelledby="multisig-tab-collectibles" tabindex="0" hidden>${collectiblesPanel(input.record, input.preferences, input.data)}</div>
    <div id="multisig-panel-intents" data-ms-home-panel="intents" role="tabpanel" aria-labelledby="multisig-tab-intents" tabindex="0" hidden>${input.intents}</div>
  </section>`;
