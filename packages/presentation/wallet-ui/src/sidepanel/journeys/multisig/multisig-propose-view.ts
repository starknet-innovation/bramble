/** Familiar transaction composer for frozen Argent multisig signing intents. */
import { escapeHtml } from "@bramble/core/html";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { emptyState } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { inputControl, textareaField, textField } from "@bramble/ui-kit/fields";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import { t, th } from "../../../i18n/messages";
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
import type { MultisigPortfolioData } from "./multisig-portfolio-data";

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
      <small>${th(recipient.source === "My account" ? "multisig.propose.myAccount" : "multisig.signers.addressBook")}</small>
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
      <span>${asset.spam ? `${th("multisig.propose.likelySpam")} · ` : ""}${escapeHtml(asset.name)}</span>
    </span>
    <span class="send-asset-value"><strong>${escapeHtml(sendBalanceLabel(asset.formatted))}</strong><span>${th("multisig.propose.balanceLabel")}</span></span>
  </button>`;

const assetPicker = (assets: readonly SendAsset[], selected: SendAsset | undefined): string => {
  if (!selected) return emptyState(t("multisig.propose.noTokens"));
  return `<details class="multisig-asset-picker" data-disclosure="multisig-transfer-asset">
    <summary class="send-token-trigger">
      <span id="multisig-selected-token-glyph">${tokenGlyph(selected.address, selected.symbol)}</span>
      <strong id="multisig-selected-token-symbol">${escapeHtml(selected.symbol)}</strong>
      ${icon("chevronDown")}
    </summary>
    <div class="disclosure-body">
      <label class="send-search send-asset-search">
        <span class="sr-only">${th("multisig.propose.searchTokens")}</span>
        <span class="send-search-control">${icon("search")}${inputControl({
          ariaLabel: t("multisig.propose.searchTokens"),
          attributes: { id: "multisig-asset-search" },
          autocomplete: "off",
          placeholder: t("multisig.propose.searchTokens"),
          spellcheck: false,
          type: "search",
        })}</span>
      </label>
      <div class="send-list-heading"><strong>${th("multisig.propose.yourTokens")}</strong><span>${th("multisig.home.balance")}</span></div>
      <div class="send-asset-list">${assets.map(assetRow).join("")}</div>
      <p class="send-asset-empty" id="multisig-asset-empty" hidden>${th("multisig.propose.noToken")}</p>
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
      <p class="send-section-title">${th("multisig.propose.from")}</p>
      <div class="send-origin-account">
        <span class="send-recipient-avatar">${accountAvatar(view.record.address)}</span>
        <span class="send-recipient-copy">
          <strong>${escapeHtml(multisigDisplayName(view.record))}</strong>
          <span class="copy-line"><code title="${escapeHtml(view.record.address)}">${escapeHtml(accountLabel(view.record.address))}</code>${inlineCopyButton(view.record.address, t("multisig.signers.copyAddress"))}</span>
        </span>
      </div>
    </div>
    ${textField({
      attributes: { id: "multisig-recipient" },
      autocomplete: "off",
      className: "mono",
      label: t("multisig.propose.to"),
      name: "recipient",
      placeholder: t("multisig.propose.toPlaceholder"),
      required: true,
      spellcheck: false,
    })}
    <details class="disclosure multisig-recipient-picker" data-disclosure="multisig-transfer-recipient">
      <summary>
        <span class="menu-copy"><strong>${th("multisig.propose.chooseRecipient")}</strong><small>${th("multisig.propose.chooseRecipientNote")}</small></span>
        <span class="disclosure-mark">${icon("chevronRight")}</span>
      </summary>
      <div class="disclosure-body send-recipient-list">
        ${recipients.length > 0 ? recipients.map(recipientRow).join("") : emptyState(t("multisig.propose.noRecipients"))}
        <p class="send-recipient-empty" id="multisig-recipient-empty" hidden>${th("multisig.propose.noRecipient")}</p>
      </div>
    </details>
    <p class="send-section-title">${th("multisig.propose.amount")}</p>
    <div class="send-amount-card">
      ${assetPicker(assets, selected)}
      <label class="send-amount-field">
        <span class="sr-only">${th("multisig.propose.amountToSend")}</span>
        ${inputControl({
          ariaLabel: t("multisig.propose.amountToSend"),
          attributes: { id: "multisig-amount" },
          autocomplete: "off",
          inputmode: "decimal",
          name: "amount",
          placeholder: "0",
        })}
      </label>
      <div class="send-amount-meta">
        <span id="multisig-balance-label">${th("multisig.propose.balance", { balance: selected ? `${sendBalanceLabel(selected.formatted)} ${selected.symbol}` : "—" })}</span>
        <span class="send-amount-shortcuts">
          <button id="multisig-max" type="button"${feeToken || !selected?.balance ? " hidden" : ""}>${th("multisig.propose.max")}</button>
        </span>
      </div>
      <p class="send-fiat-estimate" id="multisig-fiat-estimate">${th("multisig.propose.estimate", { value: "—" })}</p>
      <p class="hint" id="multisig-amount-guidance"${feeToken ? "" : " hidden"}>${th("multisig.propose.leaveFee")}</p>
    </div>
    <input name="tokenAddress" type="hidden" value="${escapeHtml(selected?.address ?? "")}" />
    <input name="tokenBalance" type="hidden" value="${escapeHtml(selected?.balance ?? "")}" />
    <input name="tokenDecimals" type="hidden" value="${selected?.decimals ?? 0}" />
    <input name="tokenFormatted" type="hidden" value="${escapeHtml(selected?.formatted ?? "")}" />
    <input name="tokenPrice" type="hidden" value="${selected?.price ?? ""}" />
    <input name="tokenSymbol" type="hidden" value="${escapeHtml(selected?.symbol ?? "token")}" />
    ${button({ disabled: !selected, icon: "send", label: t("multisig.propose.review"), type: "submit" })}
  </form>`;
};

const advancedComposer = (view: ArgentMultisigView): string => `
  <details class="disclosure multisig-advanced-call" data-disclosure="multisig-advanced-call">
    <summary>
      <span class="menu-copy"><strong>${th("multisig.propose.advanced")}</strong><small>${th("multisig.propose.advancedNote")}</small></span>
      <span class="disclosure-mark">${icon("chevronRight")}</span>
    </summary>
    <div class="disclosure-body">
      <p class="hint">${th("multisig.propose.advancedHint")}</p>
      <form class="multisig-compose-form" data-ms-prepare="contract" data-multisig-id="${escapeHtml(view.record.id)}">
        ${textField({ className: "mono", label: t("multisig.propose.target"), name: "contractAddress", placeholder: "0x…", required: true, spellcheck: false })}
        ${textField({ className: "mono", label: t("multisig.propose.entrypoint"), name: "entrypoint", placeholder: "transfer", required: true, spellcheck: false })}
        ${textareaField({ className: "mono", hint: t("multisig.propose.calldataHint"), label: t("multisig.propose.calldata"), name: "calldata", rows: 3, spellcheck: false })}
        ${button({ label: t("multisig.propose.reviewCall"), type: "submit", variant: "secondary" })}
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
      flowHeader(t("multisig.propose.title"), status) +
      flowScreen("multisig-propose", emptyState(t("multisig.detail.unwatched")))
    );
  }
  if (!view.config || view.authorityStatus !== "available") {
    const message =
      view.authorityStatus === "unsupported-signers"
        ? t("multisig.propose.unsupportedSigners")
        : view.authorityStatus === "unsupported-class"
          ? t("multisig.signers.unsupportedClass")
          : view.authorityStatus === "invalid-config"
            ? t("multisig.propose.invalidConfig")
            : view.authorityStatus === "undeployed"
              ? t("multisig.propose.deployFirst")
              : t("multisig.authority.networkUnavailable");
    return (
      flowHeader(t("multisig.propose.title"), status, multisigDisplayName(view.record)) +
      flowScreen("multisig-propose", emptyState(message))
    );
  }
  const data = portfolio ?? {
    balances: { loading: true },
    changes: {},
    currency: preferences?.displayCurrency ?? "usd",
    prices: {},
  };
  return (
    flowHeader(t("multisig.propose.title"), status, multisigDisplayName(view.record)) +
    flowScreen(
      "multisig-propose",
      `<section class="section multisig-compose-flow">
        ${transferComposer(status, view, preferences, data)}
        ${advancedComposer(view)}
      </section>`,
    )
  );
};
