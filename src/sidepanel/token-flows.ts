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
import { emptyState, receipt } from "../ui/content";
import { button } from "../ui/controls";
import { textField } from "../ui/fields";
import { formatFiat, tokenFiatValue } from "./fiat";
import { accountLabel, flowHeader, flowScreen } from "./parts";
import { sparklinePath, sparklineTrend } from "./sparkline";
import { compactAmount, tokenGlyph } from "./token-row";

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
    flowHeader("Tokens", status, "Add, detect, and hide tokens") +
    flowScreen(
      "tokens",
      `<section class="section">
        <p class="eyebrow">Add a token</p>
        <form id="token-add-form">
          ${textField({
            autocomplete: "off",
            className: "mono",
            hint: "Name, symbol, and decimals are read from the contract.",
            label: "Contract address",
            name: "address",
            placeholder: "0x…",
            required: true,
            spellcheck: false,
          })}
          ${button({ icon: "check", label: "Add token", type: "submit" })}
          <p id="token-add-result" role="status"></p>
        </form>
      </section>
      <section class="section">
        <p class="eyebrow">Auto-detect</p>
        <p class="hint">Scans a curated list of well-known Starknet tokens for balances you already hold.</p>
        ${button({
          attributes: { id: "detect-tokens" },
          icon: "refresh",
          label: "Scan for tokens",
          variant: "secondary",
        })}
        <div id="detect-results"></div>
        <p id="detect-result" role="status"></p>
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
): string => {
  const fiat = balance ? tokenFiatValue(balance.formatted, price ?? undefined) : null;
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
