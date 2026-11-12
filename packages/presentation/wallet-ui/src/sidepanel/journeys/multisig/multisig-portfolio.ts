/**
 * Shared-account portfolio composition. Balances are scoped to the watched
 * multisig contract by the privileged background and never reuse the active
 * signer's cache.
 */

import { escapeHtml } from "@bramble/core/html";
import type { ArgentMultisigRecord } from "@bramble/multisig/repository";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { emptyState } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { explorerAccountUrl } from "@bramble/wallet-model/networks";
import { t, th } from "../../../i18n/messages";
import { formatFiat, portfolioTotal } from "../../shared/fiat";
import { actionTile, explorerTile } from "../../shell/wallet-shell";
import { heroChange } from "../portfolio/hero-change";
import { visibleHomeBalances } from "../portfolio/home-tabs";
import { balanceRow } from "../portfolio/token-row";
import { type CompactIntentList, compactIntentListView } from "./multisig-intent-list";
import type { MultisigPortfolioData } from "./multisig-portfolio-data";
import { multisigStrk20KeyPanel } from "./multisig-strk20-key-view";

const portfolioHero = (
  record: ArgentMultisigRecord,
  preferences: WalletPreferences | null,
  data: MultisigPortfolioData,
): string => {
  const visible = visibleHomeBalances(data.balances, preferences);
  const hasPrices = visible.some((balance) => data.prices[balance.address] !== undefined);
  const total = hasPrices ? portfolioTotal(visible, data.prices) : null;
  return `<section class="hero multisig-portfolio-hero" aria-label="${th("multisig.home.balance")}" data-live-group>
    <p class="hero-total" data-live-key="multisig-total:${escapeHtml(record.id)}" data-live-value="${total ?? "unknown"}">${total === null ? "—" : escapeHtml(formatFiat(total, data.currency))}</p>
    ${heroChange(visible, data.prices, data.changes, data.currency)}
  </section>`;
};

const tokenPanel = (preferences: WalletPreferences | null, data: MultisigPortfolioData): string => {
  // Not read yet is not a failure: an empty, busy list until the read lands.
  if ("loading" in data.balances) return '<ul class="token-list" aria-busy="true"></ul>';
  if ("error" in data.balances) {
    return `<div class="panel-error">
      ${emptyState(t("multisig.home.balancesUnavailable"))}
      ${button({
        attributes: { "data-multisig-portfolio-retry": true },
        icon: "refresh",
        label: t("multisig.home.tryAgain"),
        size: "small",
        variant: "ghost",
      })}
    </div>`;
  }
  const visible = visibleHomeBalances(data.balances, preferences);
  return visible.length === 0
    ? emptyState(t("multisig.home.noBalances"))
    : `<ul class="token-list">${visible
        .map((token) =>
          balanceRow(token, data.prices[token.address], data.changes[token.address], data.currency),
        )
        .join("")}</ul>`;
};

/**
 * Renders the familiar wallet-home hierarchy for one multisig: portfolio,
 * multisig-specific primary actions, then Tokens and intents. The Collectibles
 * tab is parked until the NFT journey is ready.
 * Intent rows cross this boundary as structured data and are escaped by the
 * wallet's intent renderer here.
 */
export const multisigPortfolio = (input: {
  readonly authorityAvailable: boolean;
  readonly authorityMessage?: string;
  readonly canPropose: boolean;
  readonly data: MultisigPortfolioData;
  readonly deployed?: boolean | null;
  readonly deploymentPending?: boolean;
  readonly openCount: number;
  readonly preferences: WalletPreferences | null;
  readonly intentList: CompactIntentList;
  readonly record: ArgentMultisigRecord;
  readonly signerKnown: boolean;
}): string => {
  const openCount =
    Number.isSafeInteger(input.openCount) && input.openCount > 0 ? input.openCount : 0;
  const openCountText = escapeHtml(String(openCount));
  return `
  ${portfolioHero(input.record, input.preferences, input.data)}
  <section class="home-actions multisig-primary-actions" aria-label="${th("multisig.list.actions")}">
    <div class="action-row">
      ${input.deployed === false && !input.deploymentPending ? actionTile("multisig-deploy", t("multisig.home.deploy"), "wallet", true) : actionTile("multisig-propose", t("multisig.home.send"), "send", input.canPropose)}
      ${actionTile("multisig-receive", t("multisig.home.receive"), "qrCode", true)}
      ${actionTile("multisig-signers", t("multisig.home.signers"), "users", true)}
      ${explorerTile(explorerAccountUrl(input.record.networkId, input.record.address))}
    </div>
    ${
      input.deploymentPending
        ? `<p class="hint multisig-action-note"><strong>${th("multisig.home.deploySubmitted")}</strong> ${th("multisig.home.deploySubmittedNote")}</p>`
        : input.deployed === false
          ? input.record.deployment
            ? `<p class="hint multisig-action-note"><strong>${th("multisig.home.deployRequired")}</strong> ${th("multisig.home.continueSetup")}</p>`
            : `<p class="hint multisig-action-note"><strong>${th("multisig.home.deployRequired")}</strong> ${th("multisig.home.completeSetup")}</p>`
          : input.authorityMessage
            ? `<p class="hint multisig-action-note">${escapeHtml(input.authorityMessage)}</p>`
            : !input.authorityAvailable
              ? `<p class="hint multisig-action-note">${th("multisig.home.unverified")}</p>`
              : input.canPropose
                ? ""
                : input.signerKnown
                  ? `<div class="multisig-action-recovery"><p class="hint multisig-action-note"><strong>${th("multisig.home.signerFound")}</strong> ${th("multisig.home.addRemainingKeys")}</p>${button({ attributes: { "data-view": "multisig-signers" }, label: t("multisig.home.completeSignerSetup"), size: "small", variant: "secondary" })}</div>`
                  : `<p class="hint multisig-action-note">${th("multisig.home.notASigner")}</p>`
    }
  </section>
  ${multisigStrk20KeyPanel(input.record.networkId, input.preferences, input.data)}
  <section class="home-tabs multisig-portfolio-tabs" aria-label="${th("multisig.home.account")}">
    <div class="tab-bar">
      <div class="tab-set" role="tablist" aria-label="${th("multisig.home.sections")}">
        <button class="home-tab" id="multisig-tab-assets" data-ms-home-tab="assets" type="button" role="tab" aria-controls="multisig-panel-assets" aria-selected="true" tabindex="0">${th("multisig.home.tokens")}</button>
        <button class="home-tab" id="multisig-tab-intents" data-ms-home-tab="intents" type="button" role="tab" aria-controls="multisig-panel-intents" aria-selected="false" aria-label="${th("multisig.home.transactionsOpen", { count: String(openCount) })}" tabindex="-1">${th("multisig.home.transactions")}${openCount > 0 ? `<span class="home-tab-count">${openCountText}</span>` : ""}</button>
      </div>
    </div>
    <div id="multisig-panel-assets" data-ms-home-panel="assets" role="tabpanel" aria-labelledby="multisig-tab-assets" tabindex="0">${tokenPanel(input.preferences, input.data)}</div>
    <div id="multisig-panel-intents" data-ms-home-panel="intents" role="tabpanel" aria-labelledby="multisig-tab-intents" tabindex="0" hidden>
      <div class="multisig-intent-sync">
        <div><strong>${th("multisig.home.cosignerUpdates")}</strong><span>${th("multisig.home.cosignerUpdatesNote")}</span></div>
        ${button({ attributes: { "data-ms-sync-intents": true }, icon: "refresh", label: t("multisig.home.checkUpdates"), size: "small", variant: "secondary" })}
      </div>
      ${compactIntentListView(input.intentList.heading, input.intentList.items, input.intentList.emptyMessage)}
    </div>
  </section>`;
};
