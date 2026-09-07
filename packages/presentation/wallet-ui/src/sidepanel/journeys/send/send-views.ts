/**
 * Pure templates for the staged Send journey. The binding in transfer-ui.ts
 * owns state and toggles these regions without replacing the form, so recipient
 * selection, review, Ledger approval, confirmation, and recovery survive shell
 * repaints.
 */

import { escapeHtml } from "@bramble/core/html";
import type { ArgentMultisigRecord } from "@bramble/multisig/repository";
import type { DisplayCurrency, WalletPreferences } from "@bramble/settings/preferences";
import { emptyState } from "@bramble/ui-kit/content";
import { button, iconButton } from "@bramble/ui-kit/controls";
import { inputControl } from "@bramble/ui-kit/fields";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { TokenBalance, WalletStatus } from "../../../popup/responses/responses";
import { formatFiat, tokenFiatValue } from "../../shared/fiat";
import { icon } from "../../shared/icons";
import {
  accountAvatar,
  accountDisplayName,
  accountLabel,
  flowScreen,
  noAccountEmpty,
} from "../../shared/parts";
import { liquidDots, liquidDotsFilter } from "../../shared/progress-motion";
import { multisigDisplayName } from "../multisig/multisig-views";
import { starknetNetworkGlyph, tokenGlyph } from "../portfolio/token-row";
import {
  type SendAsset,
  type SendIntent,
  sendAssets,
  sendBalanceLabel,
  sendRecipientAccounts,
} from "./send-model";

const sendHeader = (): string => `
  <header class="flow-header send-flow-header">
    ${iconButton({
      attributes: { id: "send-header-back" },
      icon: "chevronLeft",
      label: "Back",
      variant: "ghost",
    })}
    <div class="flow-title"><h1 id="send-header-title">Send to</h1></div>
    ${iconButton({
      attributes: { id: "send-close" },
      icon: "x",
      label: "Close Send",
      variant: "ghost",
    })}
  </header>`;

const sendProgress = (): string => `
  <ol class="send-progress" aria-label="Send progress" hidden>
    <li data-send-step="details" data-state="active">
      <span class="send-step-mark">1</span><span>Amount</span>
    </li>
    <li data-send-step="review" data-state="pending">
      <span class="send-step-mark">2</span><span>Review</span>
    </li>
    <li data-send-step="sign" data-state="pending">
      <span class="send-step-mark">3</span><span>Authorize</span>
    </li>
    <li data-send-step="sent" data-state="pending">
      <span class="send-step-mark">4</span><span>Confirm</span>
    </li>
  </ol>`;

const recipientAccountRow = (
  account: AccountRef,
  preferences: WalletPreferences | null,
  isSender = false,
): string => `
  <button class="send-recipient-row" type="button"
    data-send-recipient="${escapeHtml(account.address)}"
    data-send-recipient-label="${escapeHtml(accountDisplayName(account, preferences))}"
    data-send-search="${escapeHtml(`${accountDisplayName(account, preferences)} ${account.address}`.toLowerCase())}">
    <span class="send-recipient-avatar">${accountAvatar(account.address)}</span>
    <span class="send-recipient-copy">
      <strong>${escapeHtml(accountDisplayName(account, preferences))}</strong>
      <code>${escapeHtml(accountLabel(account.address))}</code>
      ${isSender ? "<small>Current account · shield into its private balance</small>" : ""}
    </span>
    ${icon("chevronRight")}
  </button>`;

const addressBookRow = (entry: NonNullable<WalletPreferences["addressBook"]>[number]): string => `
  <button class="send-recipient-row" type="button"
    data-send-recipient="${escapeHtml(entry.address)}"
    data-send-recipient-label="${escapeHtml(entry.label)}"
    data-send-search="${escapeHtml(`${entry.label} ${entry.address}`.toLowerCase())}">
    <span class="send-recipient-avatar">${accountAvatar(entry.address)}</span>
    <span class="send-recipient-copy">
      <strong>${escapeHtml(entry.label)}</strong>
      <code>${escapeHtml(accountLabel(entry.address))}</code>
    </span>
    ${icon("chevronRight")}
  </button>`;

const multisigRecipientRow = (record: ArgentMultisigRecord): string => {
  const name = multisigDisplayName(record);
  return `
  <button class="send-recipient-row" type="button"
    data-send-recipient="${escapeHtml(record.address)}"
    data-send-recipient-label="${escapeHtml(name)}"
    data-send-search="${escapeHtml(`${name} multisig ${record.address}`.toLowerCase())}">
    <span class="send-recipient-avatar">${accountAvatar(record.address)}</span>
    <span class="send-recipient-copy">
      <strong>${escapeHtml(name)}</strong>
      <code>${escapeHtml(accountLabel(record.address))}</code>
      <small>Ready Multisig account</small>
    </span>
    ${icon("chevronRight")}
  </button>`;
};

const recipientStage = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  multisigs: readonly ArgentMultisigRecord[],
): string => {
  const accounts = sendRecipientAccounts(status.accounts, status.networkId);
  const sharedAccounts = multisigs.filter((record) => record.networkId === status.networkId);
  const contacts =
    preferences?.addressBook.filter((entry) => entry.networkId === status.networkId) ?? [];
  return `<section class="send-stage send-recipient-stage" id="send-recipient-stage">
    <div class="send-origin-context">
      <p class="send-section-title">Sending from</p>
      <div class="send-origin-account">
        <span class="send-recipient-avatar">${accountAvatar(account?.address ?? "")}</span>
        <span class="send-recipient-copy">
          <strong>${escapeHtml(account ? accountDisplayName(account, preferences) : "No account")}</strong>
          <code>${escapeHtml(account ? accountLabel(account.address) : "—")}</code>
        </span>
      </div>
    </div>
    <label class="send-search">
      <span>Sending to</span>
      <span class="send-search-control">${icon("search")}${inputControl({
        ariaLabel: "Recipient address or saved name",
        attributes: { id: "send-recipient-search" },
        autocomplete: "off",
        className: "mono",
        placeholder: "Address or saved name",
        spellcheck: false,
        type: "search",
      })}</span>
    </label>
    <div class="send-recipient-tabs" role="tablist" aria-label="Recipient sources">
      <button type="button" role="tab" aria-selected="true" data-send-recipient-tab="accounts">My accounts</button>
      <button type="button" role="tab" aria-selected="false" data-send-recipient-tab="contacts">Address book</button>
    </div>
    <div class="send-recipient-list" data-send-recipient-panel="accounts">
      <div class="send-list-heading">${icon("wallet")}<strong>My accounts</strong></div>
      ${
        accounts.length > 0 || sharedAccounts.length > 0
          ? accounts
              .map((stored) => recipientAccountRow(stored, preferences, stored.id === account?.id))
              .join("") + sharedAccounts.map(multisigRecipientRow).join("")
          : emptyState("No other accounts are available on this network.")
      }
    </div>
    <div class="send-recipient-list" data-send-recipient-panel="contacts" hidden>
      <div class="send-list-heading">${icon("book")}<strong>Address book</strong></div>
      ${contacts.length > 0 ? contacts.map(addressBookRow).join("") : emptyState("Your address book has no contacts on this network.")}
    </div>
    <p class="send-recipient-empty" id="send-recipient-empty" hidden>No matching recipient.</p>
    ${button({
      attributes: { id: "send-recipient-continue" },
      disabled: account === null,
      label: "Continue with address",
    })}
  </section>`;
};

const assetRow = (asset: SendAsset, currency: DisplayCurrency): string => {
  const fiat = tokenFiatValue(asset.formatted, asset.price);
  const change =
    asset.change === undefined || !Number.isFinite(asset.change)
      ? ""
      : `<span class="send-asset-change" data-direction="${asset.change < 0 ? "down" : "up"}">${asset.change < 0 ? "↓" : "↑"} ${Math.abs(asset.change).toFixed(2)}%</span>`;
  return `<button class="send-asset-row" type="button"
    data-send-asset="${escapeHtml(asset.id)}"
    data-send-address="${escapeHtml(asset.address)}"
    data-send-balance="${escapeHtml(asset.balance)}"
    data-send-decimals="${asset.decimals}"
    data-send-formatted="${escapeHtml(asset.formatted)}"
    data-send-price="${asset.price ?? ""}"
    data-send-search="${escapeHtml(`${asset.symbol} ${asset.name} ${asset.address}`.toLowerCase())}"
    data-send-symbol="${escapeHtml(asset.symbol)}">
    <span class="send-asset-glyph">${tokenGlyph(asset.address, asset.symbol)}</span>
    <span class="send-asset-copy">
      <strong>${escapeHtml(asset.symbol)}</strong>
      <span>${asset.spam ? '<em class="send-asset-spam">Likely spam</em> · ' : ""}${escapeHtml(sendBalanceLabel(asset.formatted))} ${escapeHtml(asset.symbol)}</span>
    </span>
    <span class="send-asset-value">
      <strong>${fiat === null ? "—" : escapeHtml(formatFiat(fiat, currency))}</strong>
      ${change}
    </span>
  </button>`;
};

const amountStage = (
  status: WalletStatus,
  account: AccountRef | null,
  asset: SendAsset | undefined,
  canChooseAsset: boolean,
  currency: DisplayCurrency,
  preferences: WalletPreferences | null,
): string => `
  <section class="send-stage send-amount-stage" id="send-details" hidden>
    <p class="send-section-title">Accounts</p>
    <dl class="send-context-receipt" id="send-route-controls" title="Choose where the value moves">
      <div>
        <dt>From</dt>
        <dd>
          <span class="send-context-account">
            <strong>${escapeHtml(account ? accountDisplayName(account, preferences) : "No account")}</strong>
            <code>${escapeHtml(account ? accountLabel(account.address) : "—")}</code>
          </span>
          <button class="send-route-toggle" data-send-bucket="source" data-bucket="public" type="button" title="Switch to the private balance">Public</button>
        </dd>
      </div>
      <div>
        <dt>To</dt>
        <dd>
          <span class="send-context-account">
            <strong id="send-recipient-name">Not selected</strong>
            <code id="send-recipient-label">—</code>
          </span>
          <button class="send-route-toggle" data-send-bucket="destination" data-bucket="public" type="button" title="Switch to the private balance">Public</button>
        </dd>
      </div>
      <div><dt>Network</dt><dd class="network-inline-value"><span class="network-inline-mark">${starknetNetworkGlyph()}</span><strong>${escapeHtml(status.network)}</strong></dd></div>
    </dl>
    <div class="send-route-feedback">
      <span class="send-route-reason" id="send-route-reason" hidden></span>
      <button id="send-route-retry" type="button" hidden>Retry</button>
    </div>
    <p class="send-section-title">Asset</p>
    <div class="send-amount-card">
      <button class="send-token-trigger" id="send-token-trigger" type="button" ${canChooseAsset ? "" : "disabled"}>
        <span id="send-selected-token-glyph">${asset ? tokenGlyph(asset.address, asset.symbol) : icon("coins")}</span>
        <strong id="send-selected-token-symbol">${escapeHtml(asset?.symbol ?? "Select")}</strong>
        ${icon("chevronDown")}
      </button>
      <label class="send-amount-field">
        <span class="sr-only">Amount to send</span>
        <span class="send-amount-prefix" id="send-amount-prefix" hidden></span>
        ${inputControl({
          ariaLabel: "Amount to send",
          attributes: { id: "send-amount-input" },
          autocomplete: "off",
          inputmode: "decimal",
          placeholder: "0",
        })}
      </label>
      <div class="send-amount-meta">
        <span id="send-balance-label">Balance ${escapeHtml(asset ? `${sendBalanceLabel(asset.formatted)} ${asset.symbol}` : "—")}</span>
        <span class="send-amount-shortcuts">
          <button id="send-half" type="button">Half</button>
          <button id="send-max" type="button">Max</button>
          <button id="send-unit-toggle" type="button" aria-label="Enter an amount in ${currency.toUpperCase()}">${icon("swap")}<span id="send-unit-label">${currency.toUpperCase()}</span></button>
        </span>
      </div>
      <p class="send-fiat-estimate" id="send-fiat-estimate">Estimated value —</p>
    </div>
    ${button({
      attributes: { id: "send-review-button" },
      disabled: account === null || asset === undefined,
      icon: "send",
      label: "Review send",
      type: "submit",
    })}
  </section>`;

const assetStage = (assets: readonly SendAsset[], currency: DisplayCurrency): string => `
  <section class="send-stage send-asset-stage" id="send-asset-stage" hidden>
    <label class="send-search send-asset-search">
      <span class="sr-only">Search tokens</span>
      <span class="send-search-control">${icon("search")}${inputControl({
        ariaLabel: "Search tokens",
        attributes: { id: "send-asset-search" },
        autocomplete: "off",
        placeholder: "Search tokens",
        spellcheck: false,
        type: "search",
      })}</span>
    </label>
    <div class="send-list-heading"><strong>Your tokens</strong><span>Your balance</span></div>
    <div class="send-asset-list">
      ${assets.length > 0 ? assets.map((asset) => assetRow(asset, currency)).join("") : emptyState("No tokens are tracked on this network yet.")}
    </div>
    <p class="send-asset-empty" id="send-asset-empty" hidden>No matching token.</p>
  </section>`;

const workingStage = (): string => `
  <section class="send-working" id="send-working" role="status" aria-live="polite" hidden>
    <span class="send-working-mark">${liquidDots("send")}</span>
    <div class="send-working-copy">
      <h2 id="send-working-title">Authorizing transaction</h2>
      <p id="send-working-copy">The reviewed transaction is being authorized inside the wallet.</p>
    </div>
    <ol class="send-task-list" aria-label="Transaction status">
      <li data-send-task="review" data-state="active"><span></span><span id="send-task-review-label">Review transaction</span></li>
      <li data-send-task="authorize" data-state="pending"><span></span><span id="send-task-authorize-label">Authorize</span></li>
      <li data-send-task="broadcast" data-state="pending"><span></span><span id="send-task-broadcast-label">Broadcast</span></li>
      <li data-send-task="confirm" data-state="pending"><span></span><span id="send-task-confirm-label">Confirm on Starknet</span></li>
    </ol>
    <p class="send-liveness" id="send-liveness">Keep this panel open.</p>
  </section>`;

const successStage = (): string => `
  <section class="send-outcome send-success" id="send-success" role="status" aria-live="polite" hidden>
    <span class="send-outcome-mark" aria-hidden="true">
      <svg viewBox="0 0 56 56"><circle class="send-success-ring" cx="28" cy="28" r="25" /><path class="send-success-check" d="M18 29.5l7 7 14-15" /></svg>
    </span>
    <div class="send-outcome-copy">
      <p class="send-outcome-kicker">Confirmed on Starknet</p>
      <h2>Send complete</h2>
      <p id="send-success-summary"></p>
      <code id="send-success-hash"></code>
    </div>
    <div class="send-actions">
      ${button({ attributes: { id: "send-view-activity" }, icon: "activity", label: "View activity" })}
      ${button({ attributes: { id: "send-home" }, label: "Back to home", variant: "secondary" })}
    </div>
  </section>`;

const failureStage = (): string => `
  <section class="send-outcome send-failure" id="send-failure" role="alert" aria-live="assertive" hidden>
    <span class="send-outcome-mark" aria-hidden="true">
      <svg viewBox="0 0 56 56"><circle class="send-failure-ring" cx="28" cy="28" r="25" /><path class="send-failure-mark" d="m20 20 16 16m0-16L20 36" /></svg>
    </span>
    <div class="send-outcome-copy">
      <p class="send-outcome-kicker">Nothing else will be submitted</p>
      <h2>Send not completed</h2>
      <p id="send-failure-copy">The transaction was not sent. Your balance is unchanged.</p>
      <code id="send-failure-hash"></code>
    </div>
    <div class="send-actions">
      ${button({ attributes: { id: "send-retry" }, label: "Try again" })}
      ${button({ attributes: { id: "send-failure-edit" }, label: "Edit transaction", variant: "secondary" })}
    </div>
  </section>`;

const pendingStage = (): string => `
  <section class="send-outcome send-pending" id="send-pending" role="status" aria-live="polite" hidden>
    <span class="send-working-mark">${liquidDots("send")}</span>
    <div class="send-outcome-copy">
      <p class="send-outcome-kicker">Submitted to Starknet</p>
      <h2>Confirmation is taking longer</h2>
      <p>The transaction has a hash and remains pending. You can check again or follow it in Activity.</p>
      <code id="send-pending-hash"></code>
    </div>
    <div class="send-actions">
      ${button({ attributes: { id: "send-check-again" }, label: "Check confirmation" })}
      ${button({ attributes: { id: "send-pending-activity" }, icon: "activity", label: "View activity", variant: "secondary" })}
    </div>
  </section>`;

/**
 * Renders the recipient-first Send flow and every deterministic checkpoint.
 * Fixture/cached prices are shown only as estimates; the reviewed token amount
 * and decoded calls remain the signing boundary.
 */
export const sendFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  balances: readonly TokenBalance[] = [],
  prices: Readonly<Record<string, number>> = {},
  changes: Readonly<Record<string, number>> = {},
  currency: DisplayCurrency = preferences?.displayCurrency ?? "usd",
  multisigs: readonly ArgentMultisigRecord[] = [],
  intent: SendIntent | null = null,
): string => {
  const assets = sendAssets(status.networkId, preferences, balances, prices, changes);
  const scopedIntent =
    intent && account && intent.accountId === account.id && intent.networkId === status.networkId
      ? intent
      : null;
  // A shortcut names its exact asset. If it disappeared while navigating, do
  // not silently turn the shield/unshield into a send of the first token.
  const asset = scopedIntent
    ? assets.find((candidate) => candidate.id === scopedIntent.tokenId)
    : assets[0];
  const missingIntentAsset = scopedIntent !== null && asset === undefined;
  const canSend = account !== null && asset !== undefined;
  const signer = account?.derivation.kind === "ledger" ? "ledger" : "software";
  const initialFiat =
    asset?.formatted && tokenFiatValue(asset.formatted, asset.price) !== null
      ? formatFiat(tokenFiatValue(asset.formatted, asset.price) ?? 0, currency)
      : "—";
  return (
    sendHeader() +
    flowScreen(
      "send",
      `<section class="section send-flow">
        ${account ? "" : noAccountEmpty(status)}
        ${account && assets.length === 0 ? emptyState("No tokens are tracked on this network yet, so nothing can be sent.") : ""}
        ${missingIntentAsset ? '<p class="review-flag" role="alert">The requested token is no longer tracked on this network. Choose an asset before continuing.</p>' : ""}
        <form id="transfer-form" data-signer="${signer}" data-amount-mode="token" data-send-intent="${scopedIntent ? "true" : "false"}" data-send-complete-to="${scopedIntent?.completeTo ?? ""}" data-public-balance="${escapeHtml(asset?.balance ?? "")}" data-public-formatted="${escapeHtml(asset?.formatted ?? "")}">
          ${liquidDotsFilter("send")}
          <input name="accountId" type="hidden" value="${escapeHtml(account?.id ?? "")}" />
          <input name="amount" type="hidden" value="" />
          <input name="fiatEstimate" type="hidden" value="" />
          <input name="recipient" type="hidden" value="${escapeHtml(scopedIntent?.recipient ?? "")}" />
          <input name="recipientLabel" type="hidden" value="${escapeHtml(scopedIntent?.recipientLabel ?? "")}" />
          <input name="source" type="hidden" value="${scopedIntent?.source ?? "public"}" />
          <input name="destination" type="hidden" value="${scopedIntent?.destination ?? "public"}" />
          <input name="tokenAddress" type="hidden" value="${escapeHtml(asset?.address ?? "")}" />
          <input name="tokenBalance" type="hidden" value="${escapeHtml(asset?.balance ?? "")}" />
          <input name="tokenDecimals" type="hidden" value="${asset?.decimals ?? 0}" />
          <input name="tokenFormatted" type="hidden" value="${escapeHtml(asset?.formatted ?? "")}" />
          <input name="tokenId" type="hidden" value="${escapeHtml(asset?.id ?? "")}" />
          <input name="tokenPrice" type="hidden" value="${asset?.price ?? ""}" />
          <input name="tokenSymbol" type="hidden" value="${escapeHtml(asset?.symbol ?? "token")}" />
          ${sendProgress()}
          <div class="send-stage-frame" data-initial-fiat="${escapeHtml(initialFiat)}">
            ${recipientStage(status, account, preferences, multisigs)}
            ${amountStage(status, account, asset, assets.length > 0, currency, preferences)}
            ${assetStage(assets, currency)}
            <section class="send-stage send-review-stage" id="send-review-stage" hidden>
              <div class="send-review-head">
                <div><p class="context-label">Review send</p></div>
                ${button({ attributes: { id: "send-edit" }, label: "Edit", size: "small", variant: "ghost" })}
              </div>
              <div class="send-review-summary" id="send-review-summary"></div>
              <div class="send-review-fee" id="send-review-fee" aria-live="polite"></div>
              <details class="send-review-disclosure" data-disclosure="send-technical-details">
                <summary><span>Technical details</span>${icon("chevronDown")}</summary>
                <div class="send-review-disclosure-body" id="review-panel"></div>
              </details>
              <p class="send-review-note">${canSend ? "Confirm only if the recipient, amount, and decoded action are correct." : "Send is unavailable."}</p>
              <div class="send-actions">
                <button id="send-confirm-button" type="submit" ${canSend ? "" : "disabled"}>${icon("check")}<span id="send-confirm-label">Confirm and send</span></button>
              </div>
            </section>
            ${workingStage()}
            ${pendingStage()}
            ${successStage()}
            ${failureStage()}
            <p class="send-result" id="transfer-result" role="status" aria-live="assertive"></p>
          </div>
        </form>
      </section>`,
    )
  );
};
