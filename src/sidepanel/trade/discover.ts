/**
 * Discover screen: the trade terminal's landing feed. Adapts Phantom's 3-column
 * desktop Discover (balance/positions summary + Launches + Tokens + Perps) to
 * the ~380px side panel as a single-column scrollable feed — a compact balance
 * and P&L header followed by stacked Launches / Trending tokens / Perps
 * sections. Data comes from the hardcoded SAMPLE_* literals in ./data.ts today;
 * a later pass swaps those for live feeds behind the same shapes. Every row is a
 * pure escaped-HTML string composed from the shared atoms; row buttons carry
 * data-* hooks a phase-2 binder can wire without changing this markup.
 */
import { escapeHtml } from "../../shared/html";
import {
  formatCompactUsd,
  formatPrice,
  formatUsd,
  miniSparkline,
  pctChangePill,
  statPair,
  tradeListRow,
} from "./atoms";
import type { TradeScreenContext } from "./context";
import {
  type LaunchItem,
  type PerpMarketRow,
  SAMPLE_LAUNCHES,
  SAMPLE_PERPS,
  SAMPLE_PORTFOLIO,
  SAMPLE_TOKENS,
  type TokenListItem,
} from "./data";

/**
 * Renders a round token mark from a symbol's leading letters. Returned as raw
 * HTML for a row's `leading` slot, so the symbol is escaped here.
 */
const glyph = (symbol: string): string =>
  `<span class="trade-glyph">${escapeHtml(symbol.slice(0, 3).toUpperCase())}</span>`;

/**
 * Formats a signed percentage for a plain-text stat value (e.g. "+3.42%").
 */
const signedPct = (pct: number): string => `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;

/**
 * Balance + P&L header: the portfolio total, a 24h change pill, and a compact
 * stat grid standing in for the screenshot's Total / Tokens / Perps sub-tabs.
 */
const balanceHeader = (): string => {
  const summary = SAMPLE_PORTFOLIO;
  const tokensValue = summary.positions.reduce((total, position) => total + position.valueUsd, 0);
  return `<div class="trade-hero">
      <span class="trade-hero-total">${escapeHtml(formatUsd(summary.totalValueUsd))}</span>
      <span>${pctChangePill(summary.change24hPct)} <span class="trade-row-sub">Past 24h</span></span>
    </div>
    <div class="trade-stat-grid">
      ${statPair("Available", formatUsd(summary.availableUsd))}
      ${statPair("Tokens", formatCompactUsd(tokensValue))}
      ${statPair("24h P&L", signedPct(summary.change24hPct))}
    </div>`;
};

/**
 * Renders a section heading with an optional trailing note.
 */
const sectionHead = (title: string, note: string): string =>
  `<div class="trade-section-head"><h2>${escapeHtml(title)}</h2><span>${escapeHtml(note)}</span></div>`;

/**
 * Renders one freshly launched token row: market cap as the primary figure,
 * volume beneath it, and a 24h change pill.
 */
const launchRow = (item: LaunchItem): string =>
  tradeListRow({
    action: { attr: "trade-launch", value: item.id },
    leading: glyph(item.symbol),
    subtitle: `${item.symbol} · ${item.ageLabel}`,
    title: item.name,
    trailing: pctChangePill(item.changePct),
    value: formatCompactUsd(item.marketCapUsd),
    valueSub: `Vol ${formatCompactUsd(item.volumeUsd)}`,
  });

/**
 * Renders one trending-token row: an inline sparkline and change pill alongside
 * the unit price and market cap.
 */
const tokenRow = (item: TokenListItem): string =>
  tradeListRow({
    action: { attr: "trade-token", value: item.id },
    leading: glyph(item.symbol),
    subtitle: item.symbol,
    title: item.name,
    trailing: `${miniSparkline(item.sparkline)}${pctChangePill(item.change24hPct)}`,
    value: formatPrice(item.priceUsd),
    valueSub: formatCompactUsd(item.marketCapUsd),
  });

/**
 * Renders one perpetual-market row: mark price, 24h change pill, and the max
 * leverage / funding-rate context beneath the market name.
 */
const perpRow = (row: PerpMarketRow): string =>
  tradeListRow({
    action: { attr: "trade-perp", value: row.id },
    leading: glyph(row.baseSymbol),
    subtitle: `${row.maxLeverage}x · ${signedPct(row.fundingRatePct)} funding`,
    title: row.market,
    trailing: pctChangePill(row.change24hPct),
    value: formatPrice(row.priceUsd),
    valueSub: `Vol ${formatCompactUsd(row.volume24hUsd)}`,
  });

/**
 * Wraps a set of row strings in a list, or an empty string when there is none.
 */
const list = (rows: readonly string[]): string =>
  rows.length === 0 ? "" : `<ul class="trade-list">${rows.join("")}</ul>`;

/**
 * Renders the Discover tab. Fixed call shape: (ctx: TradeScreenContext) => string.
 */
export const renderDiscover = (_ctx: TradeScreenContext): string =>
  // TODO(phase2): swap the SAMPLE_* literals for live launch/token/perp feeds and
  // wire the trade-launch/trade-token/trade-perp row buttons to detail routes.
  `<section class="trade-panel">
    ${balanceHeader()}
    ${sectionHead("Launches", "New pairs")}
    ${list(SAMPLE_LAUNCHES.map(launchRow))}
    ${sectionHead("Trending tokens", "24h")}
    ${list(SAMPLE_TOKENS.map(tokenRow))}
    ${sectionHead("Perps", "Max leverage")}
    ${list(SAMPLE_PERPS.map(perpRow))}
  </section>`;
