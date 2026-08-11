/**
 * Token management and detail flow screens. The tokens flow adds custom
 * tokens, auto-detects held registry tokens, and hides or reveals tracked
 * ones; the detail flow shows price, a self-drawn 7-day sparkline, holdings,
 * and contract facts. Pure templates — bindings live in ./tokens-ui.ts.
 */

import { escapeHtml } from "@mc-wallet/core/html";
import { isLikelySpam } from "@mc-wallet/portfolio/token-registry";
import type {
  DisplayCurrency,
  TokenConfig,
  WalletPreferences,
} from "@mc-wallet/settings/preferences";
import { emptyState, receipt } from "@mc-wallet/ui-kit/content";
import { button } from "@mc-wallet/ui-kit/controls";
import { textField } from "@mc-wallet/ui-kit/fields";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@mc-wallet/wallet-model/networks";
import type { TokenBalance, WalletStatus } from "../../../popup/responses/responses";
import { formatFiat, tokenFiatValue } from "../../shared/fiat";
import { icon } from "../../shared/icons";
import { accountLabel, flowHeader, flowScreen, walletMenuRow } from "../../shared/parts";
import type { PrivacyDisclosureState } from "../privacy/privacy-model";
import { sparklinePath, sparklineTrend } from "./sparkline";
import { compactAmount, tokenGlyph } from "./token-row";

/**
 * THE token display order: STRK first, then everything else in its existing
 * order. STRK pays every fee on Starknet, so it is the asset a user reaches for
 * most and the sensible default in any picker. Callers that also sort by another
 * key (spam last, for example) must apply that key first and fall back to this
 * one — a second STRK-first implementation would drift between screens.
 */
export const compareStrkFirst = (
  left: { readonly address: string },
  right: { readonly address: string },
): number =>
  Number(sameFelt(right.address, STRK_TOKEN_ADDRESS)) -
  Number(sameFelt(left.address, STRK_TOKEN_ADDRESS));

/**
 * Currency used by the token screens when preferences carry none.
 */
export const DEFAULT_CURRENCY: DisplayCurrency = "usd";

/**
 * Whether a token is kept off the home balances list: user-hidden tokens and
 * anything the spam heuristics flag are hidden by default.
 */
export const isHiddenFromHome = (
  token: TokenConfig,
  preferences: WalletPreferences | null,
): boolean => (preferences?.hiddenTokens ?? []).includes(token.id) || isLikelySpam(token);

const trackedRow = (
  token: TokenConfig,
  balance: TokenBalance | undefined,
  price: number | undefined,
  currency: DisplayCurrency,
  isHidden: boolean,
): string => {
  const spam = isLikelySpam(token);
  const fiat = balance ? tokenFiatValue(balance.formatted, price) : null;
  const toggle = spam
    ? '<span class="token-flag">Likely spam</span>'
    : button({
        attributes: {
          "data-token-hidden": String(isHidden),
          "data-token-toggle": token.id,
        },
        label: isHidden ? "Show" : "Hide",
        size: "small",
        variant: "secondary",
      });
  return `<li class="token-row${isHidden ? " token-hidden" : ""}">
    ${tokenGlyph(token.address, token.symbol)}
    <div class="token-copy">
      <strong>${escapeHtml(token.symbol)}</strong>
      <p>${escapeHtml(token.name)}</p>
    </div>
    <div class="token-side">
      ${balance ? `<span class="token-amount">${escapeHtml(compactAmount(balance.formatted))}</span>` : ""}
      ${fiat === null ? "" : `<span class="token-fiat">${escapeHtml(formatFiat(fiat, currency))}</span>`}
    </div>
    ${toggle}
  </li>`;
};

/**
 * Tokens flow: review tracked, hidden, and likely-spam assets. Adding and
 * discovery are separate tasks reached from the compact action list.
 */
export const tokensFlow = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
  balances: readonly TokenBalance[],
  prices: Readonly<Record<string, number>>,
  currency: DisplayCurrency,
): string => {
  const tracked = (preferences?.tokens ?? []).filter(
    (token) => token.networkId === status.networkId,
  );
  const balanceById = new Map(balances.map((balance) => [balance.id, balance]));
  return (
    flowHeader("Tokens", status, `${tracked.length} tracked`) +
    flowScreen(
      "tokens",
      `<section class="section">
        <div class="menu-list" role="group" aria-label="Token actions">
          ${walletMenuRow("token-add", "Add by contract", "plus")}
          ${walletMenuRow("token-discover", "Find held tokens", "search")}
        </div>
      </section>
      <section class="section">
        <p class="eyebrow">Tracked tokens</p>
        ${
          tracked.length === 0
            ? emptyState("No tokens tracked on this network yet.")
            : `<ul class="token-list">${tracked
                .map((token) =>
                  trackedRow(
                    token,
                    balanceById.get(token.id),
                    prices[token.address],
                    currency,
                    isHiddenFromHome(token, preferences),
                  ),
                )
                .join("")}</ul>`
        }
        <p class="hint">Hidden and likely-spam tokens stay off home but remain listed here.</p>
      </section>`,
    )
  );
};

/**
 * Renders manual token import as a focused contract-identity task.
 */
export const tokenAddFlow = (status: WalletStatus): string =>
  flowHeader("Add token", status, "Track a token by its contract") +
  flowScreen(
    "token-add",
    `<section class="section">
      <form id="token-add-form">
        ${textField({
          autocomplete: "off",
          className: "mono",
          hint: "Name, symbol, and decimals are read from the contract before it is saved.",
          label: "Contract address",
          name: "address",
          placeholder: "0x…",
          required: true,
          spellcheck: false,
        })}
        ${button({ icon: "check", label: "Read and add token", type: "submit" })}
        <p id="token-add-result" role="status"></p>
      </form>
    </section>`,
  );

/**
 * Renders curated token discovery as its own scan-and-review task.
 */
export const tokenDiscoverFlow = (status: WalletStatus): string =>
  flowHeader("Find held tokens", status, "Scan the Starknet token registry") +
  flowScreen(
    "token-discover",
    `<section class="section">
      <p class="lede">Check well-known Starknet token contracts for balances held by the active account.</p>
      <p class="hint">Nothing is added until the scan identifies a balance. Likely-spam tokens remain hidden from Home.</p>
      ${button({
        attributes: { id: "detect-tokens" },
        icon: "refresh",
        label: "Scan for tokens",
      })}
      <div id="detect-results"></div>
      <p id="detect-result" role="status"></p>
    </section>`,
  );

const sparkline = (points: readonly number[]): string => {
  const path = sparklinePath(points, 100, 32);
  if (path.length === 0) {
    return emptyState("Price history unavailable.");
  }
  return `<svg class="sparkline sparkline-${sparklineTrend(points)}" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><polyline points="${path}" /></svg>`;
};

/**
 * Token detail flow: current price, a 7-day sparkline, holdings, and the
 * contract facts. `chart` holds the recent price series; `price` is the
 * current unit price or null when offline.
 */
export const tokenDetailFlow = (
  status: WalletStatus,
  token: TokenConfig,
  balance: TokenBalance | undefined,
  chart: readonly number[],
  price: number | null,
  currency: DisplayCurrency,
  privacy: PrivacyDisclosureState = {
    error: null,
    loading: false,
    value: null,
  },
): string => {
  const fiat = balance ? tokenFiatValue(balance.formatted, price ?? undefined) : null;
  const privateBalance = privacy.value?.balances.find((entry) => entry.tokenId === token.id);
  const privateFiat = privateBalance
    ? tokenFiatValue(privateBalance.formatted, price ?? undefined)
    : null;
  const registered = privacy.value?.registration === "registered";
  const registrationPending = privacy.value?.registration === "pending";
  return (
    flowHeader(token.symbol, status, token.name) +
    flowScreen(
      "token-detail",
      `<section class="section">
        <p class="eyebrow">Price</p>
        <p class="token-detail-price">${escapeHtml(price === null ? "Unavailable" : formatFiat(price, currency))}</p>
        ${sparkline(chart)}
        <p class="hint">7-day price from CoinGecko. Shown for information only.</p>
      </section>
      <section class="section">
        <p class="eyebrow">Your balance</p>
        <div class="token-side">
          <span class="token-amount">${escapeHtml(balance ? `${compactAmount(balance.formatted)} ${token.symbol}` : `0 ${token.symbol}`)}</span>
          ${fiat === null ? "" : `<span class="token-fiat">${escapeHtml(formatFiat(fiat, currency))}</span>`}
        </div>
        ${
          registered
            ? `<div class="private-balance-summary">
                <span class="private-balance-label">${icon("lock")}<span>Private balance</span></span>
                <span class="token-side">
                  <strong class="token-amount">${escapeHtml(`${compactAmount(privateBalance?.formatted ?? "0")} ${token.symbol}`)}</strong>
                  ${privateFiat === null ? "" : `<span class="token-fiat">${escapeHtml(formatFiat(privateFiat, currency))}</span>`}
                </span>
              </div>`
            : privacy.value
              ? `<div class="private-balance-summary muted" title="${registrationPending ? "Waiting for the privacy indexer to see your registration" : "Register to start shielding"}">
                <span class="private-balance-label">${icon("lock")}<span>Private balance</span></span>
                <span class="token-fiat">${registrationPending ? "Registration pending…" : "Register to start shielding"}</span>
              </div>`
              : ""
        }
        ${
          registered
            ? `<div class="token-privacy-actions">${button({
                attributes: { "data-send-shield": token.id },
                icon: "shield",
                label: "Shield",
              })}${button({
                attributes: { "data-send-unshield": token.id },
                label: "Unshield",
                variant: "secondary",
              })}</div>`
            : button({
                attributes: { "data-privacy-open": token.id },
                icon: "shield",
                label: registrationPending ? "Registration pending" : "Go private",
              })
        }
        ${privacy.error ? `<p class="hint">${escapeHtml(privacy.error)}</p>` : ""}
      </section>
      <section class="section">
        <p class="eyebrow">Contract</p>
        ${receipt([
          {
            action: {
              attributes: { "data-copy": token.address },
              icon: "copy",
              label: "Copy token address",
            },
            label: "Address",
            value: accountLabel(token.address),
            valueStyle: "code",
          },
          { label: "Symbol", value: token.symbol },
          { label: "Decimals", value: String(token.decimals) },
          { label: "Network", value: status.network },
        ])}
      </section>`,
    )
  );
};
