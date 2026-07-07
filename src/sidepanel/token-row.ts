/**
 * Token balance row: symbol + compact amount on the left, fiat value and 24h
 * change on the right. Split from ./views.ts to keep it within the size budget.
 */
import type { TokenBalance } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { DisplayCurrency } from "../storage/preferences-store";
import { formatFiat, tokenFiatValue } from "./fiat";

const groupThousands = (whole: string): string => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * Renders a token amount with grouped thousands and at most five decimals,
 * dropping trailing zeros so "1.0" reads as "1".
 */
export const compactAmount = (formatted: string): string => {
  const [whole = "0", fraction = ""] = formatted.split(".");
  const grouped = groupThousands(whole);
  if (fraction.length === 0) {
    return grouped;
  }
  const trimmed = fraction.slice(0, 5).replace(/0+$/, "");
  return trimmed.length === 0 ? grouped : `${grouped}.${trimmed}`;
};

const changeBadge = (change: number | undefined): string => {
  if (change === undefined || !Number.isFinite(change)) {
    return "";
  }
  const direction = change >= 0 ? "up" : "down";
  const arrow = change >= 0 ? "↑" : "↓";
  return `<span class="token-change ${direction}">${arrow} ${Math.abs(change).toFixed(2)}%</span>`;
};

/**
 * Renders one tappable token row for the home balances list.
 */
export const balanceRow = (
  token: TokenBalance,
  price: number | undefined,
  change: number | undefined,
  currency: DisplayCurrency,
): string => {
  const fiat = tokenFiatValue(token.formatted, price);
  return `<li class="token-row">
    <button class="token-open" type="button" data-token-detail="${escapeHtml(token.id)}">
      <span class="token-mark">${escapeHtml(token.symbol.slice(0, 3))}</span>
      <div class="token-copy">
        <strong>${escapeHtml(token.symbol)}</strong>
        <p>${escapeHtml(compactAmount(token.formatted))}</p>
      </div>
      <div class="token-side">
        <span class="token-amount">${fiat === null ? "—" : escapeHtml(formatFiat(fiat, currency))}</span>
        ${changeBadge(change)}
      </div>
    </button>
  </li>`;
};
