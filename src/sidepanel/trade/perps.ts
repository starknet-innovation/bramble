/**
 * Perps screen: the trade terminal's perpetual-futures surface. Renders the
 * region-locked notice (Extended is geo-gated), a markets list built from
 * SAMPLE_PERPS (symbol, leverage, mark price, 24h change), and — for the focused
 * market — the full market detail (price chart, order book / recent trades, a
 * Long/Short order ticket, and the Positions/Trades/Funding/Orders strip; see
 * ./perps-detail.ts).
 *
 * Extended settles perps off-chain via SNIP-12-signed orders rather than the
 * in-wallet invoke path, so the market rows and order ticket emit data-* hooks a
 * phase-2 binder wires to extended.fetchMarkets / extended.signOrder (the shell
 * only re-binds; it never re-renders). Static, escaped-HTML strings composed from
 * the shared atoms; a later pass swaps SAMPLE_* for live Extended feeds behind
 * the same shapes.
 */
import { escapeHtml } from "../../shared/html";
import { icon } from "../icons";
import { formatCompactUsd, formatPrice, pctChangePill, tradeListRow } from "./atoms";
import type { TradeScreenContext } from "./context";
import { type PerpMarketRow, SAMPLE_PERPS } from "./data";
import { renderPerpDetail } from "./perps-detail";

/**
 * Round token mark for a market row's leading slot. Returned as raw HTML, so the
 * symbol is escaped here.
 */
const glyph = (symbol: string): string =>
  `<span class="trade-glyph">${escapeHtml(symbol.slice(0, 3).toUpperCase())}</span>`;

/**
 * Signed funding rate as plain text (funding is a small percentage, e.g.
 * "+0.012%").
 */
const signedPct = (pct: number): string => `${pct >= 0 ? "+" : ""}${pct.toFixed(3)}%`;

/**
 * Region-locked notice shown above the markets list. Dismissible via
 * data-perp-dismiss (a phase-2 binder removes the callout); informational only,
 * so it never blocks the list or ticket beneath it.
 */
const regionBanner = (): string =>
  `<div class="callout row" data-perp-region>
    <span class="callout-icon">${icon("alert")}</span>
    <span class="callout-copy">
      <strong>Region restricted</strong>
      <p>Access to this product isn't available in your region.</p>
    </span>
    <button class="icon-button ghost" type="button" data-perp-dismiss aria-label="Dismiss notice">${icon("x")}</button>
  </div>`;

/**
 * One perpetual-market row: mark price, 24h change pill, and the leverage /
 * funding context beneath the market name. The row button carries the
 * data-perp-market hook a binder wires to focus the market detail.
 */
const marketRow = (row: PerpMarketRow): string =>
  tradeListRow({
    action: { attr: "perp-market", value: row.id },
    leading: glyph(row.baseSymbol),
    subtitle: `Up to ${row.maxLeverage}x · ${signedPct(row.fundingRatePct)} funding`,
    title: row.market,
    trailing: pctChangePill(row.change24hPct),
    value: formatPrice(row.priceUsd),
    valueSub: `Vol ${formatCompactUsd(row.volume24hUsd)}`,
  });

/**
 * Renders the Perps tab. Fixed call shape: (ctx: TradeScreenContext) => string.
 */
export const renderPerps = (_ctx: TradeScreenContext): string => {
  // TODO(phase2): call extended.fetchMarkets on mount to replace SAMPLE_PERPS,
  // wire data-perp-market rows to focus a market, and route the order ticket's
  // data-perp-submit through extended.signOrder + the exchange POST.
  const focused = SAMPLE_PERPS[0];
  const markets =
    SAMPLE_PERPS.length === 0
      ? ""
      : `<ul class="trade-list">${SAMPLE_PERPS.map(marketRow).join("")}</ul>`;
  return `<section class="trade-panel">
    ${regionBanner()}
    <div class="trade-section-head"><h2>Markets</h2><span>Perpetuals</span></div>
    ${markets}
    ${focused ? renderPerpDetail(focused) : ""}
  </section>`;
};
