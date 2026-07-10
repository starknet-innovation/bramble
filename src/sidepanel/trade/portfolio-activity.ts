/**
 * Hardcoded, deterministic activity feeds for the Portfolio screen's "Token
 * Activity" and "Perps Activity" tabs, plus their pure row/panel renderers. Split
 * out of ./portfolio to keep each module small. Every value is a literal (no
 * clocks, no randomness) and ages are pre-rendered relative strings, so no time
 * math (banned in src/) is needed. A later pass swaps these arrays for the
 * wallet's live activity feed behind the same shapes.
 */
import { escapeHtml } from "../../shared/html";
import { formatUsd, tradeListRow, tradePlaceholder } from "./atoms";

/**
 * One entry in the Token Activity feed. `valueUsd` is the trade's fiat size;
 * `inflow` marks a receive/buy (shown with a leading +) versus a send/sell.
 */
export type TokenActivityItem = {
  readonly id: string;
  readonly action: string;
  readonly symbol: string;
  readonly amount: string;
  readonly valueUsd: number;
  readonly ageLabel: string;
  readonly inflow: boolean;
};

/**
 * One entry in the Perps Activity feed. `pnlUsd` is the realised P&L for a close
 * or funding event, or null for an open where no P&L is settled yet.
 */
export type PerpActivityItem = {
  readonly id: string;
  readonly action: string;
  readonly market: string;
  readonly base: string;
  readonly detail: string;
  readonly pnlUsd: number | null;
  readonly ageLabel: string;
};

/**
 * Sample token trade/transfer history for the Token Activity tab.
 */
export const TOKEN_ACTIVITY: readonly TokenActivityItem[] = [
  {
    id: "act-eth-buy",
    action: "Bought",
    symbol: "ETH",
    amount: "0.5",
    valueUsd: 1560.25,
    ageLabel: "2h",
    inflow: true,
  },
  {
    id: "act-strk-sell",
    action: "Sold",
    symbol: "STRK",
    amount: "5,000",
    valueUsd: 710.0,
    ageLabel: "8h",
    inflow: false,
  },
  {
    id: "act-usdc-recv",
    action: "Received",
    symbol: "USDC",
    amount: "500",
    valueUsd: 500.0,
    ageLabel: "1d",
    inflow: true,
  },
  {
    id: "act-eth-send",
    action: "Sent",
    symbol: "ETH",
    amount: "0.2",
    valueUsd: 624.1,
    ageLabel: "3d",
    inflow: false,
  },
];

/**
 * Sample perpetual position history for the Perps Activity tab.
 */
export const PERP_ACTIVITY: readonly PerpActivityItem[] = [
  {
    id: "perp-btc-open",
    action: "Opened",
    market: "BTC-USD",
    base: "BTC",
    detail: "Long · 5x",
    pnlUsd: null,
    ageLabel: "1h",
  },
  {
    id: "perp-eth-close",
    action: "Closed",
    market: "ETH-USD",
    base: "ETH",
    detail: "Short · 3x",
    pnlUsd: 142.5,
    ageLabel: "6h",
  },
  {
    id: "perp-strk-funding",
    action: "Funding",
    market: "STRK-USD",
    base: "STRK",
    detail: "Long · 10x",
    pnlUsd: -3.2,
    ageLabel: "12h",
  },
  {
    id: "perp-sol-close",
    action: "Closed",
    market: "SOL-USD",
    base: "SOL",
    detail: "Long · 5x",
    pnlUsd: -54.0,
    ageLabel: "2d",
  },
];

/**
 * Renders a round token mark from a symbol's leading letters. Returned as raw
 * HTML for a row's `leading` slot, so the symbol is escaped here.
 */
const glyph = (symbol: string): string =>
  `<span class="trade-glyph">${escapeHtml(symbol.slice(0, 3).toUpperCase())}</span>`;

/**
 * Formats a signed fiat P&L string (e.g. "+$142.50" / "-$54.00").
 */
const signedUsd = (value: number): string =>
  `${value >= 0 ? "+" : "-"}${formatUsd(Math.abs(value))}`;

const tokenActivityRow = (item: TokenActivityItem): string =>
  tradeListRow({
    action: { attr: "portfolio-activity", value: item.id },
    leading: glyph(item.symbol),
    subtitle: item.ageLabel,
    title: `${item.action} ${item.symbol}`,
    value: `${item.inflow ? "+" : "-"}${formatUsd(item.valueUsd)}`,
    valueSub: `${item.amount} ${item.symbol}`,
  });

const perpActivityRow = (item: PerpActivityItem): string =>
  tradeListRow({
    action: { attr: "portfolio-activity", value: item.id },
    leading: glyph(item.base),
    subtitle: item.detail,
    title: `${item.action} ${item.market}`,
    trailing:
      item.pnlUsd === null
        ? ""
        : `<span class="trade-pill ${item.pnlUsd >= 0 ? "up" : "down"}">${signedUsd(item.pnlUsd)}</span>`,
    valueSub: item.ageLabel,
  });

/**
 * Renders the Token Activity tab body as a list of trade/transfer rows, or a
 * placeholder when the feed is empty.
 */
export const renderTokenActivity = (): string =>
  TOKEN_ACTIVITY.length === 0
    ? tradePlaceholder("No token activity", "Your token trades and transfers will appear here.")
    : `<ul class="trade-list">${TOKEN_ACTIVITY.map(tokenActivityRow).join("")}</ul>`;

/**
 * Renders the Perps Activity tab body as a list of position events, or a
 * placeholder when the feed is empty.
 */
export const renderPerpActivity = (): string =>
  PERP_ACTIVITY.length === 0
    ? tradePlaceholder(
        "No perps activity",
        "Your perp opens, closes, and funding will appear here.",
      )
    : `<ul class="trade-list">${PERP_ACTIVITY.map(perpActivityRow).join("")}</ul>`;
