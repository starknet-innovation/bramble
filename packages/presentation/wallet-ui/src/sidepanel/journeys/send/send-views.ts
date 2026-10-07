/**
 * Pure templates for the staged Send journey. The binding in transfer-ui.ts
 * owns state and toggles these regions without replacing the form, so recipient
 * selection, review, Ledger approval, confirmation, and recovery survive shell
 * repaints.
 */

import { escapeHtml } from "@bramble/core/html";
import type { ArgentMultisigRecord } from "@bramble/multisig/repository";
import type { DisplayCurrency, WalletPreferences } from "@bramble/settings/preferences";
import { button, iconButton, switchControl } from "@bramble/ui-kit/controls";
import { inputControl } from "@bramble/ui-kit/fields";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { TokenBalance, WalletStatus } from "../../../popup/responses/responses";
import { formatFiat, tokenFiatValue } from "../../shared/fiat";
import { icon } from "../../shared/icons";
import { networkDisplayName } from "../../shared/network-label";
import { outcomeHashRow } from "../../shared/outcome-hash";
import {
  accountDisplayName,
  accountLabel,
  flowScreen,
  flowSteps,
  inlineCopyButton,
  noAccountEmpty,
} from "../../shared/parts";
import { liquidDots, liquidDotsFilter } from "../../shared/progress-motion";
import { tokenDropdown } from "../../shared/token-dropdown";
import { starknetNetworkGlyph, tokenGlyph } from "../portfolio/token-row";
import { type SendAsset, type SendIntent, sendAssets, sendBalanceLine } from "./send-model";
import { recipientStage } from "./send-recipient-view";
import {
  TRANSFER_FAILURE_TITLE,
  type TransferMode,
  type TransferModeCopy,
  transferModeCopy,
  transferModeFor,
  transferStageTitle,
} from "./transfer-mode";

// A shortcut opens on the amount step, so the header's first words are the
// mode's own; a plain send opens on the recipient prompt.
const sendHeader = (mode: TransferMode, copy: TransferModeCopy): string => `
  <header class="flow-header send-flow-header">
    ${iconButton({
      attributes: { id: "send-header-back" },
      icon: "chevronLeft",
      label: "Back",
      variant: "ghost",
    })}
    <div class="flow-title"><h1 id="send-header-title">${escapeHtml(transferStageTitle(mode === "send" ? "recipient" : "details", mode))}</h1></div>
    ${iconButton({
      attributes: { id: "send-close" },
      icon: "x",
      label: copy.closeLabel,
      variant: "ghost",
    })}
  </header>`;

const sendProgress = (copy: TransferModeCopy): string =>
  flowSteps("data-send-step", copy.progressLabel, [
    ["recipient", "Recipient"],
    ["details", "Amount"],
    ["review", "Confirm"],
  ]);

// The dropdown shows a ticker; composing needs the token's decimals, balance
// and price. Those travel in one hidden element per token, keyed by the same id
// the dropdown returns, so the binding reads them without a second lookup.
const assetFacts = (asset: SendAsset): string => `<span
  data-send-asset="${escapeHtml(asset.id)}"
  data-send-address="${escapeHtml(asset.address)}"
  data-send-balance="${escapeHtml(asset.balance)}"
  data-send-decimals="${asset.decimals}"
  data-send-formatted="${escapeHtml(asset.formatted)}"
  data-send-price="${asset.price ?? ""}"
  data-send-symbol="${escapeHtml(asset.symbol)}"><span class="send-asset-glyph">${tokenGlyph(asset.address, asset.symbol)}</span></span>`;

// The route control is a switch, not a label: what it toggles is privacy, so it
// names "Private" once and shows on/off, rather than renaming itself to the
// state it is already in — which read as static text and was reported as such.
const routeSwitch = (leg: "destination" | "source", label: string): string =>
  switchControl({
    attributes: {
      "aria-label": label,
      "data-bucket": "public",
      "data-send-bucket": leg,
      title: "Switch to the private balance",
    },
    className: "send-route-toggle",
    icon: "lock",
    label: "Private",
  });

const amountStage = (
  status: WalletStatus,
  account: AccountRef | null,
  asset: SendAsset | undefined,
  assets: readonly SendAsset[],
  currency: DisplayCurrency,
  preferences: WalletPreferences | null,
  copy: TransferModeCopy,
): string => `
  <section class="send-stage send-amount-stage" id="send-details" hidden>
    <p class="send-section-title">Accounts</p>
    <dl class="send-context-receipt" id="send-route-controls" title="Choose where the value moves">
      <div>
        <dt>From</dt>
        <dd>
          <span class="send-context-account">
            <strong>${escapeHtml(account ? accountDisplayName(account, preferences) : "No account")}</strong>
            ${account ? `<span class="copy-line"><code title="${escapeHtml(account.address)}">${escapeHtml(accountLabel(account.address))}</code>${inlineCopyButton(account.address, "Copy sending account address")}</span>` : "<code>—</code>"}
          </span>
          ${routeSwitch("source", "Send from the private balance")}
        </dd>
      </div>
      <div>
        <dt>To</dt>
        <dd>
          <span class="send-context-account">
            <strong id="send-recipient-name">Not selected</strong>
            <span class="copy-line"><code id="send-recipient-label">—</code>${inlineCopyButton("", "Copy recipient address", { hidden: true, id: "send-recipient-copy" })}</span>
          </span>
          ${routeSwitch("destination", "Receive into the private balance")}
        </dd>
      </div>
      <div><dt>Network</dt><dd class="network-inline-value"><span class="network-inline-mark">${starknetNetworkGlyph()}</span><strong>${escapeHtml(networkDisplayName(status.network))}</strong></dd></div>
    </dl>
    <div class="send-route-feedback">
      <span class="send-route-reason" id="send-route-reason" hidden></span>
      <button id="send-route-retry" type="button" hidden>Retry</button>
    </div>
    <p class="send-section-title">Asset</p>
    <div class="send-amount-card">
      <div class="token-dropdown">
        <button class="send-token-trigger" id="send-token-trigger" type="button" ${assets.length > 0 ? "" : "disabled"}>
          <span id="send-selected-token-glyph">${asset ? tokenGlyph(asset.address, asset.symbol) : icon("coins")}</span>
          <strong id="send-selected-token-symbol">${escapeHtml(asset?.symbol ?? "Select")}</strong>
          ${icon("chevronDown")}
        </button>
        ${tokenDropdown({
          action: "Manage tokens",
          groups: [
            {
              label: "Your tokens",
              options: assets.map((entry) => ({
                address: entry.address,
                id: entry.id,
                symbol: entry.symbol,
              })),
            },
          ],
          label: "Tokens you can send",
          panelId: "send-token-options",
          ...(asset ? { selectedId: asset.id } : {}),
        })}
      </div>
      <div class="send-asset-facts" hidden>${assets.map((entry) => assetFacts(entry)).join("")}</div>
      <label class="send-amount-field">
        <span class="sr-only" id="send-amount-label">${escapeHtml(copy.amountLabel)}</span>
        <span class="send-amount-prefix" id="send-amount-prefix" hidden></span>
        ${inputControl({
          ariaLabel: copy.amountLabel,
          attributes: { id: "send-amount-input" },
          autocomplete: "off",
          inputmode: "decimal",
          placeholder: "0",
        })}
      </label>
      <div class="send-amount-meta">
        <span id="send-balance-label">${escapeHtml(asset ? sendBalanceLine("public", asset.formatted, asset.symbol) : "Balance —")}</span>
        <span class="send-amount-shortcuts">
          <button id="send-half" type="button">Half</button>
          <button id="send-max" type="button">Max</button>
          <button id="send-unit-toggle" type="button" aria-label="Enter an amount in ${currency.toUpperCase()}">${icon("swap")}<span id="send-unit-label">${currency.toUpperCase()}</span></button>
        </span>
      </div>
      <p class="send-fiat-estimate" id="send-fiat-estimate">Estimated value —</p>
    </div>
    <button id="send-review-button" type="submit" ${account === null || asset === undefined ? "disabled" : ""}>${icon("send")}${liquidDots("send", true)}<span id="send-review-label">${escapeHtml(copy.reviewLabel)}</span></button>
  </section>`;

const workingStage = (): string => `
  <section class="send-working" id="send-working" role="status" aria-live="polite" hidden>
    <span class="send-working-mark">${liquidDots("send")}</span>
    <div class="send-working-copy">
      <h2 id="send-working-title">Sending your transaction…</h2>
      <p id="send-working-copy" hidden></p>
    </div>
  </section>`;

const successStage = (copy: TransferModeCopy): string => `
  <section class="send-outcome send-success" id="send-success" role="status" aria-live="polite" hidden>
    <span class="send-outcome-mark" aria-hidden="true">
      <svg viewBox="0 0 56 56"><circle class="send-success-ring" cx="28" cy="28" r="25" /><path class="send-success-check" d="M18 29.5l7 7 14-15" /></svg>
    </span>
    <div class="send-outcome-copy">
      <h2 id="send-success-title">${escapeHtml(copy.successTitle)}</h2>
    </div>
    <div class="send-receipt">
      <p class="send-receipt-summary" id="send-success-summary"></p>
      <div class="send-receipt-tx">
        <span class="send-receipt-label">Transaction</span>
        ${outcomeHashRow("send-success-hash")}
      </div>
    </div>
    <div class="send-actions">
      ${button({ attributes: { id: "send-view-activity" }, icon: "activity", label: "View in Activity tab" })}
      ${button({ attributes: { id: "send-home" }, label: "Back", variant: "secondary" })}
    </div>
  </section>`;

const failureStage = (): string => `
  <section class="send-outcome send-failure" id="send-failure" role="alert" aria-live="assertive" hidden>
    <span class="send-outcome-mark" aria-hidden="true">
      <svg viewBox="0 0 56 56"><circle class="send-failure-ring" cx="28" cy="28" r="25" /><path class="send-failure-mark" d="m20 20 16 16m0-16L20 36" /><path class="send-unknown-mark" d="M28 17v13m0 8v1" /></svg>
    </span>
    <div class="send-outcome-copy">
      <h2 id="send-failure-title">${escapeHtml(TRANSFER_FAILURE_TITLE)}</h2>
      <span class="send-outcome-reason">
        <p id="send-failure-copy">The transaction was not sent. Your balance is unchanged.</p>
        ${inlineCopyButton("", "Copy the error", { id: "send-failure-copy-error" })}
      </span>
      ${outcomeHashRow("send-failure-hash")}
    </div>
    <div class="send-actions">
      ${button({ attributes: { hidden: true, id: "send-failure-activity" }, icon: "activity", label: "View in Activity tab" })}
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
      ${outcomeHashRow("send-pending-hash")}
    </div>
    <div class="send-actions">
      ${button({ attributes: { id: "send-check-again" }, label: "Check confirmation" })}
      ${button({ attributes: { id: "send-pending-activity" }, icon: "activity", label: "View in Activity tab", variant: "secondary" })}
    </div>
  </section>`;

// Which asset the screen opens on. A shortcut names its exact asset and must
// not silently fall back to the first token — that would turn a shield into a
// send of something else. A preset asset is a preference rather than a promise:
// it came from a screen about that token, and the first tracked asset is a fine
// answer when it is no longer tracked.
const openingAsset = (
  assets: readonly SendAsset[],
  intent: SendIntent | null,
  seedTokenId: string | null,
): SendAsset | undefined => {
  if (intent) {
    return assets.find((candidate) => candidate.id === intent.tokenId);
  }
  const seeded =
    seedTokenId === null ? undefined : assets.find((candidate) => candidate.id === seedTokenId);
  return seeded ?? assets[0];
};

// The sending account travels on the form: its address drives the mode and
// the receipt, and its display name labels it there the way the rest of the
// wallet names it. Empty without an account, which nothing can send from.
const senderAttributes = (
  account: AccountRef | null,
  preferences: WalletPreferences | null,
): string =>
  account
    ? `data-sender="${escapeHtml(account.address)}" data-sender-label="${escapeHtml(accountDisplayName(account, preferences))}"`
    : 'data-sender="" data-sender-label=""';

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
  /**
   * Opens on this asset without seeding a recipient, so the flow still starts
   * on the recipient step. A shortcut's own `intent` wins: it names a recipient
   * as well and opens further along.
   */
  seedTokenId: string | null = null,
): string => {
  const assets = sendAssets(status.networkId, preferences, balances, prices, changes);
  const scopedIntent =
    intent && account && intent.accountId === account.id && intent.networkId === status.networkId
      ? intent
      : null;
  // A shortcut names its exact asset. If it disappeared while navigating, do
  // not silently turn the shield/unshield into a send of the first token.
  const asset = openingAsset(assets, scopedIntent, seedTokenId);
  const missingIntentAsset = scopedIntent !== null && asset === undefined;
  const canSend = account !== null && asset !== undefined;
  const signer = account?.derivation.kind === "ledger" ? "ledger" : "software";
  // The first paint already speaks in the shortcut's words; the binding keeps
  // the same derivation live as the buckets and recipient change.
  const mode = scopedIntent ? transferModeFor(scopedIntent, account?.address ?? "") : "send";
  const copy = transferModeCopy(mode);
  const initialFiat =
    asset?.formatted && tokenFiatValue(asset.formatted, asset.price) !== null
      ? formatFiat(tokenFiatValue(asset.formatted, asset.price) ?? 0, currency)
      : "—";
  return (
    sendHeader(mode, copy) +
    flowScreen(
      "send",
      `<section class="section send-flow">
        ${account ? "" : noAccountEmpty(status)}
        ${missingIntentAsset ? '<p class="review-flag" role="alert">The requested token is no longer tracked on this network. Choose an asset before continuing.</p>' : ""}
        <form id="transfer-form" data-signer="${signer}" ${senderAttributes(account, preferences)} data-send-network="${escapeHtml(status.networkId)}" data-send-available="${canSend}" data-amount-mode="token" data-send-intent="${scopedIntent ? "true" : "false"}" data-send-complete-to="${scopedIntent?.completeTo ?? ""}" data-public-balance="${escapeHtml(asset?.balance ?? "")}" data-public-formatted="${escapeHtml(asset?.formatted ?? "")}">
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
          ${sendProgress(copy)}
          <div class="send-stage-frame" data-initial-fiat="${escapeHtml(initialFiat)}">
            ${recipientStage(status, account, preferences, multisigs)}
            ${amountStage(status, account, asset, assets, currency, preferences, copy)}
            <section class="send-stage send-review-stage" id="send-review-stage" hidden>
              <div class="send-review-summary" id="send-review-summary"></div>
              <div class="send-review-fee" id="send-review-fee" aria-live="polite"></div>
              <div class="send-review-risks" id="send-review-risks" role="note"></div>
              ${canSend ? "" : '<p class="send-review-note" id="send-review-note">Send is unavailable.</p>'}
              <div class="send-actions">
                <button id="send-confirm-button" type="submit" ${canSend ? "" : "disabled"}>${icon("check")}<span id="send-confirm-label">${escapeHtml(copy.confirmLabel)}</span></button>
              </div>
            </section>
            ${workingStage()}
            ${pendingStage()}
            ${successStage(copy)}
            ${failureStage()}
            <p class="send-result" id="transfer-result" role="alert" aria-live="assertive"></p>
          </div>
        </form>
      </section>`,
    )
  );
};
