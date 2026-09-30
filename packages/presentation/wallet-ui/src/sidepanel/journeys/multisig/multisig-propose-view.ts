/** Familiar transaction composer for frozen Argent multisig signing intents. */
import { escapeHtml } from "@bramble/core/html";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { emptyState } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { inputControl, textareaField, textField } from "@bramble/ui-kit/fields";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import type { ArgentMultisigView } from "../../../popup/responses/multisig-responses";
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import {
  accountAvatar,
  accountDisplayName,
  accountLabel,
  flowHeader,
  flowScreen,
  inlineCopyButton,
} from "../../shared/parts";
import { tokenGlyph } from "../portfolio/token-row";
import { type SendAsset, sendAssets, sendBalanceLabel } from "../send/send-model";
import { multisigDisplayName } from "./multisig-model";
import type { MultisigPortfolioData } from "./multisig-portfolio";

type ProposeRecipient = {
  readonly address: string;
  readonly label: string;
  readonly source: "Address book" | "My account";
};

const proposeRecipients = (
  status: WalletStatus,
  view: ArgentMultisigView,
  preferences: WalletPreferences | null,
): readonly ProposeRecipient[] => {
  const candidates: ProposeRecipient[] = [
    ...status.accounts
      .filter((account) => account.networkId === view.record.networkId)
      .map((account) => ({
        address: account.address,
        label: accountDisplayName(account, preferences),
        source: "My account" as const,
      })),
    ...(preferences?.addressBook ?? [])
      .filter((entry) => entry.networkId === view.record.networkId)
      .map((entry) => ({
        address: entry.address,
        label: entry.label,
        source: "Address book" as const,
      })),
  ];
  return candidates.filter(
    (candidate, index) =>
      !sameFelt(candidate.address, view.record.address) &&
      candidates.findIndex((entry) => sameFelt(entry.address, candidate.address)) === index,
  );
};

const recipientRow = (recipient: ProposeRecipient): string => `
  <button class="send-recipient-row" type="button"
    data-ms-propose-recipient="${escapeHtml(recipient.address)}"
    data-ms-recipient-search="${escapeHtml(`${recipient.label} ${recipient.address}`.toLowerCase())}">
    <span class="send-recipient-avatar">${accountAvatar(recipient.address)}</span>
    <span class="send-recipient-copy">
      <strong>${escapeHtml(recipient.label)}</strong>
      <code>${escapeHtml(accountLabel(recipient.address))}</code>
      <small>${recipient.source}</small>
    </span>
    ${icon("chevronRight")}
  </button>`;

const assetRow = (asset: SendAsset): string => `
  <button class="send-asset-row" type="button"
    data-ms-propose-asset="${escapeHtml(asset.id)}"
    data-ms-asset-address="${escapeHtml(asset.address)}"
    data-ms-asset-balance="${escapeHtml(asset.balance)}"
    data-ms-asset-decimals="${asset.decimals}"
    data-ms-asset-formatted="${escapeHtml(asset.formatted)}"
    data-ms-asset-price="${asset.price ?? ""}"
    data-ms-asset-search="${escapeHtml(`${asset.symbol} ${asset.name} ${asset.address}`.toLowerCase())}"
    data-ms-asset-symbol="${escapeHtml(asset.symbol)}">
    <span class="send-asset-glyph">${tokenGlyph(asset.address, asset.symbol)}</span>
    <span class="send-asset-copy">
      <strong>${escapeHtml(asset.symbol)}</strong>
      <span>${asset.spam ? "Likely spam · " : ""}${escapeHtml(asset.name)}</span>
    </span>
    <span class="send-asset-value"><strong>${escapeHtml(sendBalanceLabel(asset.formatted))}</strong><span>Balance</span></span>
  </button>`;

const assetPicker = (assets: readonly SendAsset[], selected: SendAsset | undefined): string => {
  if (!selected) return emptyState("No tracked tokens are available for this multisig.");
  return `<details class="multisig-asset-picker" data-disclosure="multisig-transfer-asset">
    <summary class="send-token-trigger">
      <span id="multisig-selected-token-glyph">${tokenGlyph(selected.address, selected.symbol)}</span>
      <strong id="multisig-selected-token-symbol">${escapeHtml(selected.symbol)}</strong>
      ${icon("chevronDown")}
    </summary>
    <div class="disclosure-body">
      <label class="send-search send-asset-search">
        <span class="sr-only">Search tokens</span>
        <span class="send-search-control">${icon("search")}${inputControl({
          ariaLabel: "Search tokens",
          attributes: { id: "multisig-asset-search" },
          autocomplete: "off",
          placeholder: "Search tokens",
          spellcheck: false,
          type: "search",
        })}</span>
      </label>
      <div class="send-list-heading"><strong>Your tokens</strong><span>Multisig balance</span></div>
      <div class="send-asset-list">${assets.map(assetRow).join("")}</div>
      <p class="send-asset-empty" id="multisig-asset-empty" hidden>No matching token.</p>
    </div>
  </details>`;
};

const transferComposer = (
  status: WalletStatus,
  view: ArgentMultisigView,
  preferences: WalletPreferences | null,
  portfolio: MultisigPortfolioData,
): string => {
  const balances = "balances" in portfolio.balances ? portfolio.balances.balances : [];
  const assets = sendAssets(
    view.record.networkId,
    preferences,
    balances,
    portfolio.prices,
    portfolio.changes,
  );
  const selected = assets[0];
  const recipients = proposeRecipients(status, view, preferences);
  const feeToken = selected ? sameFelt(selected.address, STRK_TOKEN_ADDRESS) : false;
  return `<form class="multisig-compose-form" id="multisig-propose-form"
      data-currency="${portfolio.currency}"
      data-ms-prepare="transfer"
      data-multisig-id="${escapeHtml(view.record.id)}">
    <div class="multisig-compose-origin">
      <p class="send-section-title">From</p>
      <div class="send-origin-account">
        <span class="send-recipient-avatar">${accountAvatar(view.record.address)}</span>
        <span class="send-recipient-copy">
          <strong>${escapeHtml(multisigDisplayName(view.record))}</strong>
          <span class="copy-line"><code title="${escapeHtml(view.record.address)}">${escapeHtml(accountLabel(view.record.address))}</code>${inlineCopyButton(view.record.address, "Copy multisig address")}</span>
        </span>
      </div>
    </div>
    ${textField({
      attributes: { id: "multisig-recipient" },
      autocomplete: "off",
      className: "mono",
      label: "To",
      name: "recipient",
      placeholder: "Address or saved name",
      required: true,
      spellcheck: false,
    })}
    <details class="disclosure multisig-recipient-picker" data-disclosure="multisig-transfer-recipient">
      <summary>
        <span class="menu-copy"><strong>Choose saved recipient</strong><small>My accounts and address book</small></span>
        <span class="disclosure-mark">${icon("chevronRight")}</span>
      </summary>
      <div class="disclosure-body send-recipient-list">
        ${recipients.length > 0 ? recipients.map(recipientRow).join("") : emptyState("No saved recipients are available on this network.")}
        <p class="send-recipient-empty" id="multisig-recipient-empty" hidden>No matching recipient.</p>
      </div>
    </details>
    <p class="send-section-title">Amount</p>
    <div class="send-amount-card">
      ${assetPicker(assets, selected)}
      <label class="send-amount-field">
        <span class="sr-only">Amount to send</span>
        ${inputControl({
          ariaLabel: "Amount to send",
          attributes: { id: "multisig-amount" },
          autocomplete: "off",
          inputmode: "decimal",
          name: "amount",
          placeholder: "0",
        })}
      </label>
      <div class="send-amount-meta">
        <span id="multisig-balance-label">Balance ${escapeHtml(selected ? `${sendBalanceLabel(selected.formatted)} ${selected.symbol}` : "—")}</span>
        <span class="send-amount-shortcuts">
          <button id="multisig-max" type="button"${feeToken || !selected?.balance ? " hidden" : ""}>Max</button>
        </span>
      </div>
      <p class="send-fiat-estimate" id="multisig-fiat-estimate">Estimated value —</p>
      <p class="hint" id="multisig-amount-guidance"${feeToken ? "" : " hidden"}>Leave enough STRK for the network fee.</p>
    </div>
    <input name="tokenAddress" type="hidden" value="${escapeHtml(selected?.address ?? "")}" />
    <input name="tokenBalance" type="hidden" value="${escapeHtml(selected?.balance ?? "")}" />
    <input name="tokenDecimals" type="hidden" value="${selected?.decimals ?? 0}" />
    <input name="tokenFormatted" type="hidden" value="${escapeHtml(selected?.formatted ?? "")}" />
    <input name="tokenPrice" type="hidden" value="${selected?.price ?? ""}" />
    <input name="tokenSymbol" type="hidden" value="${escapeHtml(selected?.symbol ?? "token")}" />
    ${button({ disabled: !selected, icon: "send", label: "Review transaction", type: "submit" })}
  </form>`;
};

const advancedComposer = (view: ArgentMultisigView): string => `
  <details class="disclosure multisig-advanced-call" data-disclosure="multisig-advanced-call">
    <summary>
      <span class="menu-copy"><strong>Advanced contract call</strong><small>Enter exact Starknet call data</small></span>
      <span class="disclosure-mark">${icon("chevronRight")}</span>
    </summary>
    <div class="disclosure-body">
      <p class="hint">Use this only when a token transfer does not describe the action. Every felt will be frozen exactly as entered.</p>
      <form class="multisig-compose-form" data-ms-prepare="contract" data-multisig-id="${escapeHtml(view.record.id)}">
        ${textField({ className: "mono", label: "Target contract", name: "contractAddress", placeholder: "0x…", required: true, spellcheck: false })}
        ${textField({ className: "mono", label: "Entrypoint", name: "entrypoint", placeholder: "transfer", required: true, spellcheck: false })}
        ${textareaField({ className: "mono", hint: "Whitespace-separated canonical felts. Leave empty only when the entrypoint takes no calldata.", label: "Calldata", name: "calldata", rows: 3, spellcheck: false })}
        ${button({ label: "Review contract call", type: "submit", variant: "secondary" })}
      </form>
    </div>
  </details>`;

/**
 * Renders a token-transfer-first composer; raw calls remain available through
 * progressive disclosure and background validation remains authoritative.
 */
export const multisigProposeFlow = (
  status: WalletStatus,
  view: ArgentMultisigView | null,
  preferences: WalletPreferences | null = null,
  portfolio?: MultisigPortfolioData,
): string => {
  if (!view) {
    return (
      flowHeader("New transaction", status) +
      flowScreen("multisig-propose", emptyState("This multisig is no longer watched."))
    );
  }
  if (!view.config || view.authorityStatus !== "available") {
    const message =
      view.authorityStatus === "unsupported-signers"
        ? "This account uses signer types this wallet cannot sign with. It remains available to watch and receive."
        : view.authorityStatus === "unsupported-class"
          ? "This address is not the pinned Ready Multisig 0.2 account."
          : view.authorityStatus === "invalid-config"
            ? "The account returned an invalid signer configuration."
            : view.authorityStatus === "undeployed"
              ? "Deploy this account before creating a transaction."
              : "Signer authority could not be refreshed. Check the network and retry.";
    return (
      flowHeader("New transaction", status, multisigDisplayName(view.record)) +
      flowScreen("multisig-propose", emptyState(message))
    );
  }
  const data = portfolio ?? {
    balances: { error: "Multisig balances are loading." },
    changes: {},
    currency: preferences?.displayCurrency ?? "usd",
    prices: {},
  };
  return (
    flowHeader("New transaction", status, multisigDisplayName(view.record)) +
    flowScreen(
      "multisig-propose",
      `<section class="section multisig-compose-flow">
        ${transferComposer(status, view, preferences, data)}
        ${advancedComposer(view)}
      </section>`,
    )
  );
};
