/**
 * Recipient-first Multisig proposal composer. The common token-transfer path
 * deliberately mirrors Send; arbitrary contract calls remain a separate,
 * explicit expert stage.
 */

import { escapeHtml } from "@mc-wallet/core/html";
import type { MultisigRecord } from "@mc-wallet/multisig/repository";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { emptyState } from "@mc-wallet/ui-kit/content";
import { button } from "@mc-wallet/ui-kit/controls";
import { inputControl, textareaField, textField } from "@mc-wallet/ui-kit/fields";
import { sameFelt } from "@mc-wallet/wallet-model/networks";
import type { WalletStatus } from "../popup/responses";
import { formatFiat, tokenFiatValue } from "./fiat";
import { icon } from "./icons";
import { multisigDisplayName } from "./multisig-model";
import { EMPTY_MULTISIG_PORTFOLIO, type MultisigPortfolioData } from "./multisig-portfolio";
import {
  accountAvatar,
  accountDisplayName,
  accountLabel,
  flowHeader,
  flowScreen,
  hardwareBadge,
} from "./parts";
import { type SendAsset, sendAssets, sendBalanceLabel } from "./send-model";
import { starknetNetworkGlyph, tokenGlyph } from "./token-row";

const recipientRow = (address: string, label: string, source: "account" | "contact"): string => `
  <button class="send-recipient-row" type="button"
    data-proposal-recipient="${escapeHtml(address)}"
    data-proposal-recipient-label="${escapeHtml(label)}"
    data-proposal-recipient-source="${source}"
    data-proposal-search="${escapeHtml(`${label} ${address}`.toLowerCase())}">
    <span class="send-recipient-avatar">${accountAvatar(address)}</span>
    <span class="send-recipient-copy"><strong>${escapeHtml(label)}</strong><code>${escapeHtml(accountLabel(address))}</code></span>
    ${icon("chevronRight")}
  </button>`;

const recipientStage = (status: WalletStatus, preferences: WalletPreferences | null): string => {
  const accounts = status.accounts.filter((stored) => stored.networkId === status.networkId);
  const contacts =
    preferences?.addressBook.filter((entry) => entry.networkId === status.networkId) ?? [];
  return `<section class="send-stage send-recipient-stage proposal-stage" data-proposal-stage-panel="recipient">
    <div class="proposal-stage-heading">
      <p class="eyebrow">New transfer proposal</p>
      <h2>Who should receive it?</h2>
      <p>Select a saved recipient or enter a Starknet address.</p>
    </div>
    <label class="send-search">
      <span>Recipient</span>
      <span class="send-search-control">${icon("search")}${inputControl({
        ariaLabel: "Recipient address or saved name",
        attributes: { id: "proposal-recipient-search" },
        autocomplete: "off",
        className: "mono",
        placeholder: "Address or saved name",
        spellcheck: false,
        type: "search",
      })}</span>
    </label>
    <div class="send-recipient-tabs" role="tablist" aria-label="Recipient sources">
      <button type="button" role="tab" aria-selected="true" data-proposal-recipient-tab="account">My accounts</button>
      <button type="button" role="tab" aria-selected="false" data-proposal-recipient-tab="contact">Address book</button>
    </div>
    <div class="send-recipient-list" data-proposal-recipient-panel="account">
      <div class="send-list-heading">${icon("wallet")}<strong>My accounts</strong></div>
      ${accounts.length > 0 ? accounts.map((stored) => recipientRow(stored.address, accountDisplayName(stored, preferences), "account")).join("") : emptyState("No wallet accounts are available on this network.")}
    </div>
    <div class="send-recipient-list" data-proposal-recipient-panel="contact" hidden>
      <div class="send-list-heading">${icon("book")}<strong>Address book</strong></div>
      ${contacts.length > 0 ? contacts.map((entry) => recipientRow(entry.address, entry.label, "contact")).join("") : emptyState("Your address book has no contacts on this network.")}
    </div>
    <p class="send-recipient-empty" id="proposal-recipient-empty" hidden>No matching recipient.</p>
    ${button({
      attributes: { id: "proposal-recipient-continue" },
      disabled: true,
      label: "Continue with address",
    })}
    <button class="proposal-advanced-entry" id="proposal-advanced-entry" type="button">${icon("settings")}Build an advanced contract call</button>
  </section>`;
};

const assetRow = (asset: SendAsset, currency: MultisigPortfolioData["currency"]): string => {
  const fiat = tokenFiatValue(asset.formatted, asset.price);
  return `<button class="send-asset-row" type="button"
    data-proposal-token="${escapeHtml(asset.address)}"
    data-proposal-token-balance="${escapeHtml(asset.balance)}"
    data-proposal-token-decimals="${asset.decimals}"
    data-proposal-token-formatted="${escapeHtml(asset.formatted)}"
    data-proposal-token-price="${asset.price ?? ""}"
    data-proposal-token-search="${escapeHtml(`${asset.symbol} ${asset.name} ${asset.address}`.toLowerCase())}"
    data-proposal-token-symbol="${escapeHtml(asset.symbol)}">
    <span class="send-asset-glyph">${tokenGlyph(asset.address, asset.symbol)}</span>
    <span class="send-asset-copy"><strong>${escapeHtml(asset.symbol)}</strong><span>${escapeHtml(sendBalanceLabel(asset.formatted))} ${escapeHtml(asset.symbol)}</span></span>
    <span class="send-asset-value"><strong>${fiat === null ? "—" : escapeHtml(formatFiat(fiat, currency))}</strong></span>
  </button>`;
};

const amountStage = (
  status: WalletStatus,
  record: MultisigRecord,
  asset: SendAsset | undefined,
  currency: MultisigPortfolioData["currency"],
): string => `
  <section class="send-stage send-amount-stage proposal-stage" data-proposal-stage-panel="amount" hidden>
    <button class="proposal-inline-back" data-proposal-stage-back="recipient" type="button">${icon("chevronLeft")}Recipient</button>
    <div class="proposal-stage-heading">
      <p class="eyebrow">Transfer amount</p>
      <h2>Choose a token and amount</h2>
    </div>
    <div class="send-amount-card">
      <button class="send-token-trigger" id="proposal-token-trigger" type="button" ${asset ? "" : "disabled"}>
        <span id="proposal-selected-token-glyph">${asset ? tokenGlyph(asset.address, asset.symbol) : icon("coins")}</span>
        <strong id="proposal-selected-token-symbol">${escapeHtml(asset?.symbol ?? "Select")}</strong>
        ${icon("chevronDown")}
      </button>
      <label class="send-amount-field">
        <span class="sr-only">Amount to propose</span>
        <span class="send-amount-prefix" id="proposal-amount-prefix" hidden></span>
        ${inputControl({
          ariaLabel: "Amount to propose",
          attributes: { id: "proposal-amount-input" },
          autocomplete: "off",
          inputmode: "decimal",
          placeholder: "0",
        })}
      </label>
      <div class="send-amount-meta">
        <span id="proposal-balance-label">Balance ${escapeHtml(asset ? `${sendBalanceLabel(asset.formatted)} ${asset.symbol}` : "—")}</span>
        <span class="send-amount-shortcuts">
          <button id="proposal-half" type="button">Half</button>
          <button id="proposal-max" type="button">Max</button>
          <button id="proposal-unit-toggle" type="button" aria-label="Enter amount in ${currency.toUpperCase()}">${icon("swap")}<span id="proposal-unit-label">${currency.toUpperCase()}</span></button>
        </span>
      </div>
      <p class="send-fiat-estimate" id="proposal-fiat-estimate">Estimated value —</p>
    </div>
    <dl class="send-context-receipt">
      <div><dt>Recipient</dt><dd><strong id="proposal-recipient-name">Not selected</strong><code id="proposal-recipient-label">—</code></dd></div>
      <div><dt>Network</dt><dd class="network-inline-value"><span class="network-inline-mark">${starknetNetworkGlyph()}</span><strong>${escapeHtml(status.network)}</strong></dd></div>
      <div><dt>From</dt><dd><strong>${escapeHtml(multisigDisplayName(record))}</strong><code>${escapeHtml(accountLabel(record.address))}</code></dd></div>
    </dl>
    ${button({
      attributes: { id: "proposal-review-button" },
      disabled: asset === undefined,
      icon: "send",
      label: "Review proposal",
    })}
  </section>`;

const assetStage = (
  assets: readonly SendAsset[],
  currency: MultisigPortfolioData["currency"],
): string => `
  <section class="send-stage send-asset-stage proposal-stage" data-proposal-stage-panel="asset" hidden>
    <button class="proposal-inline-back" data-proposal-stage-back="amount" type="button">${icon("chevronLeft")}Amount</button>
    <div class="proposal-stage-heading"><p class="eyebrow">Asset</p><h2>Choose a token</h2></div>
    <label class="send-search send-asset-search">
      <span class="sr-only">Search tokens</span>
      <span class="send-search-control">${icon("search")}${inputControl({
        ariaLabel: "Search tokens",
        attributes: { id: "proposal-asset-search" },
        autocomplete: "off",
        placeholder: "Search tokens",
        spellcheck: false,
        type: "search",
      })}</span>
    </label>
    <div class="send-list-heading"><strong>Shared account tokens</strong><span>Balance</span></div>
    <div class="send-asset-list">
      ${assets.length > 0 ? assets.map((asset) => assetRow(asset, currency)).join("") : emptyState("No tracked tokens are available for this shared account.")}
    </div>
    <p class="send-asset-empty" id="proposal-asset-empty" hidden>No matching token.</p>
  </section>`;

const advancedStage = (): string => `
  <section class="proposal-stage proposal-advanced-stage" data-proposal-stage-panel="advanced" hidden>
    <button class="proposal-inline-back" data-proposal-stage-back="recipient" type="button">${icon("chevronLeft")}Common actions</button>
    <div class="proposal-stage-heading">
      <p class="eyebrow">Expert action</p><h2>Advanced contract call</h2>
      <p>Only use raw calldata when every field has been independently decoded.</p>
    </div>
    <fieldset class="proposal-fieldset">
      ${textField({ autocomplete: "off", className: "mono", label: "Target contract", name: "to", placeholder: "0x…", spellcheck: false })}
      ${textField({ autocomplete: "off", className: "mono", label: "Method", name: "entrypoint", placeholder: "transfer", spellcheck: false })}
      ${textareaField({ autocomplete: "off", className: "mono", label: "Calldata felts", name: "calldata", rows: 3, spellcheck: false })}
    </fieldset>
    ${button({
      attributes: { id: "proposal-advanced-review" },
      icon: "search",
      label: "Review call",
    })}
  </section>`;

const reviewStage = (): string => `
  <section class="send-stage send-review-stage proposal-stage" data-proposal-stage-panel="review" hidden>
    <div class="send-review-head">
      <div><p class="context-label">Review proposal</p><h2>Check every detail</h2></div>
      ${button({
        attributes: { id: "proposal-edit" },
        label: "Edit",
        size: "small",
        variant: "ghost",
      })}
    </div>
    <div id="multisig-propose-review" aria-live="polite"></div>
    <p class="send-review-note">Submitting creates this proposal. It does not confirm or execute the action.</p>
    ${button({
      attributes: { id: "proposal-submit" },
      icon: "check",
      label: "Submit proposal",
      type: "submit",
    })}
  </section>`;

/**
 * Renders the staged common-action proposal flow with an explicit advanced
 * escape hatch. Shared balances are address-scoped before they reach here.
 */
export const multisigProposeFlow = (
  status: WalletStatus,
  record: MultisigRecord | null,
  preferences: WalletPreferences | null = null,
  portfolio: MultisigPortfolioData = EMPTY_MULTISIG_PORTFOLIO,
): string => {
  if (!record) {
    return (
      flowHeader("New proposal", status) +
      flowScreen("multisig-propose", emptyState("This multisig is no longer watched."))
    );
  }
  const localSigners = status.accounts.filter(
    (stored) =>
      stored.networkId === record.networkId &&
      record.signers.some((signer) => sameFelt(signer, stored.address)),
  );
  const signer =
    localSigners.find((stored) => stored.id === status.activeAccountId) ?? localSigners[0];
  if (!signer) {
    return (
      flowHeader("New proposal", status, multisigDisplayName(record)) +
      flowScreen(
        "multisig-propose",
        emptyState("This wallet does not own a current signer for this multisig."),
      )
    );
  }
  const balances = "balances" in portfolio.balances ? portfolio.balances.balances : [];
  const assets = sendAssets(
    status.networkId,
    preferences,
    balances,
    portfolio.prices,
    portfolio.changes,
  );
  const asset = assets[0];
  return (
    flowHeader("New proposal", status, multisigDisplayName(record)) +
    flowScreen(
      "multisig-propose",
      `<section class="section proposal-flow">
        <form class="proposal-compose-form" id="multisig-propose-form"
          data-multisig-id="${escapeHtml(record.id)}"
          data-proposal-mode="send"
          data-proposal-stage="recipient"
          data-amount-mode="token"
          data-currency="${portfolio.currency}"
          data-multisig-address="${escapeHtml(record.address)}"
          data-multisig-name="${escapeHtml(multisigDisplayName(record))}"
          data-network="${escapeHtml(status.network)}"
          data-signer-account-address="${escapeHtml(signer.address)}"
          data-signer-account-id="${escapeHtml(signer.id)}"
          data-signer-account-name="${escapeHtml(accountDisplayName(signer, preferences))}">
          <div class="proposal-signing-context" role="note">
            <span class="option-avatar">${accountAvatar(signer.address)}</span>
            <span><small>Proposal signer</small><strong>${escapeHtml(accountDisplayName(signer, preferences))}${hardwareBadge(signer)}</strong></span>
            <code>${escapeHtml(accountLabel(signer.address))}</code>
          </div>
          <input name="guidedRecipient" type="hidden" value="" />
          <input name="guidedToken" type="hidden" value="${escapeHtml(asset?.address ?? "")}" />
          <input name="guidedDecimals" type="hidden" value="${asset?.decimals ?? ""}" />
          <input name="guidedSymbol" type="hidden" value="${escapeHtml(asset?.symbol ?? "")}" />
          <input name="guidedBalance" type="hidden" value="${escapeHtml(asset?.balance ?? "0")}" />
          <input name="guidedFormatted" type="hidden" value="${escapeHtml(asset?.formatted ?? "0")}" />
          <input name="guidedPrice" type="hidden" value="${asset?.price ?? ""}" />
          <input name="guidedAmount" type="hidden" value="" />
          ${recipientStage(status, preferences)}
          ${amountStage(status, record, asset, portfolio.currency)}
          ${assetStage(assets, portfolio.currency)}
          ${advancedStage()}
          ${reviewStage()}
          <details class="disclosure proposal-options" data-proposal-options hidden>
            <summary><span class="menu-copy"><strong>Proposal options</strong><span>Salt 0x0 · optional signer note</span></span><span class="disclosure-mark">${icon("chevronRight")}</span></summary>
            <div class="disclosure-body">
              ${textField({ autocomplete: "off", label: "Note for signers", maxlength: 120, name: "summary", placeholder: "Optional — describe the intent" })}
              ${textField({ autocomplete: "off", className: "mono", label: "Proposal salt", name: "salt", spellcheck: false, value: "0x0" })}
              <p class="hint">Change the salt only when proposing the same action again.</p>
            </div>
          </details>
          <p id="multisig-propose-result" role="status" aria-live="assertive"></p>
        </form>
      </section>`,
    )
  );
};
