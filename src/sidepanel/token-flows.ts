/**
 * Token management and detail flow screens. The tokens flow adds custom
 * tokens, auto-detects held registry tokens, and hides or reveals tracked
 * ones; the detail flow shows price, a self-drawn 7-day sparkline, holdings,
 * and contract facts. Pure templates — bindings live in ./tokens-ui.ts.
 */
import type { TokenBalance, WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { isLikelySpam } from "../starknet/token-registry";
import type { DisplayCurrency, TokenConfig, WalletPreferences } from "../storage/preferences-store";
import { formatFiat, tokenFiatValue } from "./fiat";
import { icon } from "./icons";
import { copyButton, flowHeader, flowScreen } from "./parts";
import { sparklinePath, sparklineTrend } from "./sparkline";
import { tokenGlyph } from "./token-row";

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
    : `<button class="secondary small" type="button" data-token-toggle="${escapeHtml(token.id)}" data-token-hidden="${isHidden ? "true" : "false"}">${isHidden ? "Show" : "Hide"}</button>`;
  return `<li class="token-row${isHidden ? " token-hidden" : ""}">
    ${tokenGlyph(token.address, token.symbol)}
    <div class="token-copy">
      <strong>${escapeHtml(token.symbol)}</strong>
      <p>${escapeHtml(token.name)}</p>
    </div>
    <div class="token-side">
      ${balance ? `<span class="token-amount">${escapeHtml(balance.formatted)}</span>` : ""}
      ${fiat === null ? "" : `<span class="token-fiat">${escapeHtml(formatFiat(fiat, currency))}</span>`}
    </div>
    ${toggle}
  </li>`;
};

/**
 * Tokens flow: add a custom token, auto-detect held registry tokens, and
 * manage which tracked tokens show on home.
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
    flowHeader("Tokens", "home", status, "Add, detect, and hide tokens") +
    flowScreen(
      "tokens",
      `<section class="section">
        <h2>Add a token</h2>
        <form id="token-add-form">
          <label><span>Contract address</span>
            <input class="mono" name="address" placeholder="0x…" required autocomplete="off" spellcheck="false" />
            <span class="hint">Name, symbol, and decimals are read from the contract.</span>
          </label>
          <button type="submit">${icon("check")}Add token</button>
          <p id="token-add-result" role="status"></p>
        </form>
      </section>
      <section class="section">
        <h2>Auto-detect</h2>
        <p class="hint">Scans a curated list of well-known Starknet tokens for balances you already hold.</p>
        <button id="detect-tokens" class="secondary" type="button">${icon("refresh")}Scan for tokens</button>
        <div id="detect-results"></div>
        <p id="detect-result" role="status"></p>
      </section>
      <section class="section">
        <h2>Tracked tokens</h2>
        ${
          tracked.length === 0
            ? '<p class="empty">No tokens tracked on this network yet.</p>'
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

const sparkline = (points: readonly number[]): string => {
  const path = sparklinePath(points, 100, 32);
  if (path.length === 0) {
    return '<p class="empty">Price history unavailable.</p>';
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
): string => {
  const fiat = balance ? tokenFiatValue(balance.formatted, price ?? undefined) : null;
  return (
    flowHeader(token.symbol, "home", status, token.name) +
    flowScreen(
      "token-detail",
      `<section class="section">
        <p class="eyebrow">Price</p>
        <p class="token-detail-price">${escapeHtml(price === null ? "Unavailable" : formatFiat(price, currency))}</p>
        ${sparkline(chart)}
        <p class="hint">7-day price from CoinGecko. Shown for information only.</p>
      </section>
      <section class="section">
        <h2>Your balance</h2>
        <div class="token-side">
          <span class="token-amount">${escapeHtml(balance ? `${balance.formatted} ${token.symbol}` : `0 ${token.symbol}`)}</span>
          ${fiat === null ? "" : `<span class="token-fiat">${escapeHtml(formatFiat(fiat, currency))}</span>`}
        </div>
      </section>
      <section class="section">
        <h2>Contract</h2>
        <p class="eyebrow">Address</p>
        <div class="address-line"><code>${escapeHtml(token.address)}</code>${copyButton(token.address, "Copy token address")}</div>
        <div class="detail-grid">
          <div class="detail"><p>Decimals</p><p class="value">${token.decimals}</p></div>
          <div class="detail"><p>Symbol</p><p class="value">${escapeHtml(token.symbol)}</p></div>
        </div>
      </section>`,
    )
  );
};
