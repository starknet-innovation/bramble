/**
 * Perps market detail: the drill-in for one perpetual market, rendered inline by
 * the Perps screen. Composes a price header with a trend chart, an order book /
 * recent-trades panel, a Long/Short order ticket (Market/Limit, size, leverage,
 * liquidation + order-value estimates, auto-close), and the
 * Positions/Trades/Funding/Orders account strip.
 *
 * Extended settles perps off-chain via SNIP-12-signed orders rather than the
 * in-wallet invoke path, so the ticket carries data-* hooks a phase-2 binder
 * wires to extended.fetchMarkets / extended.signOrder (data-perp-protocol tags
 * the client). Everything is derived deterministically from the focused market's
 * sample row (see ./perps-data.ts) — no clocks, no randomness — and a later pass
 * swaps the derivations for live Extended feeds behind the same shapes.
 *
 * The design system resets native range/checkbox inputs to opaque boxes, so the
 * leverage control and auto-close toggle use the segmented-button and
 * aria-pressed patterns the rest of the wallet uses, not raw form controls.
 */
import { escapeHtml } from "../../shared/html";
import { extended } from "../../starknet/protocols";
import {
  formatCompactUsd,
  formatPrice,
  formatUsd,
  miniBarChart,
  miniSparkline,
  pctChangePill,
  type SegmentTab,
  segmentedTabBar,
  statPair,
} from "./atoms";
import type { PerpMarketRow } from "./data";
import {
  type AccountTrade,
  ASK_LEVELS,
  BID_LEVELS,
  type BookLevel,
  type FundingRow,
  type OrderRow,
  PERP_CHART,
  PERP_VOLUME_BARS,
  type PositionRow,
  SAMPLE_ACCOUNT_TRADES,
  SAMPLE_FUNDING,
  SAMPLE_ORDERS,
  SAMPLE_POSITIONS,
  TAPE,
} from "./perps-data";

/** Default order size, in base-asset units, used to prefill the ticket + estimates. */
const DEFAULT_SIZE_BASE = 0.1;

/** Taker fee applied to notional in the estimate breakdown (5 bps). */
const TAKER_FEE_RATE = 0.0005;

/** Signed percentage as plain text (e.g. "+6.42%"). */
const signedPct = (pct: number): string => `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;

/** Signed USD amount as plain text (e.g. "+$418.75"). */
const signedUsd = (value: number): string =>
  `${value >= 0 ? "+" : "-"}${formatUsd(Math.abs(value))}`;

/** Price offset by a basis-point delta from a mark price. */
const offsetPrice = (mark: number, bps: number): number => mark * (1 + bps / 10000);

/** Detail price header: mark price, 24h pill, and the trend + volume mini charts. */
const detailHeader = (market: PerpMarketRow): string => {
  const series = market.change24hPct < 0 ? [...PERP_CHART].reverse() : PERP_CHART;
  return `<div class="trade-hero">
      <span class="trade-hero-total">${escapeHtml(formatPrice(market.priceUsd))}</span>
      <span>${pctChangePill(market.change24hPct)} <span class="trade-row-sub">${escapeHtml(market.market)} · Past 24h</span></span>
    </div>
    <div class="row">${miniSparkline(series)}${miniBarChart(PERP_VOLUME_BARS)}</div>
    <div class="trade-stat-grid">
      ${statPair("Mark", formatPrice(market.priceUsd))}
      ${statPair("Funding", signedPct(market.fundingRatePct))}
      ${statPair("Max leverage", `${market.maxLeverage}x`)}
      ${statPair("24h volume", formatCompactUsd(market.volume24hUsd))}
    </div>`;
};

/** One order-book / tape line: a colored price chip and a muted size · meta span. */
const bookLine = (dir: "down" | "up", price: number, size: number, meta: string): string =>
  `<div class="row"><span class="trade-pill ${dir}">${escapeHtml(formatPrice(price))}</span><span class="hint">${escapeHtml(
    `${size.toFixed(3)} · ${meta}`,
  )}</span></div>`;

/** Cumulative-size ladder for one side of the book. */
const ladder = (levels: readonly BookLevel[], dir: "down" | "up", mark: number): string => {
  let total = 0;
  return levels
    .map((level) => {
      total += level.size;
      return bookLine(
        dir,
        offsetPrice(mark, dir === "up" ? -level.offsetBps : level.offsetBps),
        level.size,
        total.toFixed(3),
      );
    })
    .join("");
};

/** Spread readout between the best bid and ask. */
const spreadLine = (mark: number): string => {
  const nearestAsk = Math.min(...ASK_LEVELS.map((level) => level.offsetBps));
  const nearestBid = Math.min(...BID_LEVELS.map((level) => level.offsetBps));
  const spread = offsetPrice(mark, nearestAsk) - offsetPrice(mark, -nearestBid);
  const spreadBps = (spread / mark) * 10000;
  return `<div class="row"><span class="eyebrow">Spread</span><span class="hint">${escapeHtml(
    `${formatPrice(spread)} · ${spreadBps.toFixed(1)} bps`,
  )}</span></div>`;
};

/** Order book panel: asks, spread, bids. */
const orderBookPanel = (mark: number): string =>
  `<div class="stack-tight" data-perp-book-panel="orderbook">
    ${ladder(ASK_LEVELS, "down", mark)}
    ${spreadLine(mark)}
    ${ladder(BID_LEVELS, "up", mark)}
  </div>`;

/** Recent-trades panel: the printed tape. */
const tradesPanel = (mark: number): string =>
  `<div class="stack-tight" data-perp-book-panel="trades" hidden>
    ${TAPE.map((entry) =>
      bookLine(
        entry.side === "buy" ? "up" : "down",
        offsetPrice(mark, entry.offsetBps),
        entry.size,
        entry.time,
      ),
    ).join("")}
  </div>`;

/** Order book / Trades tabbed section. */
const bookSection = (mark: number): string => {
  const tabs: readonly SegmentTab[] = [
    { id: "orderbook", label: "Order book" },
    { id: "trades", label: "Trades" },
  ];
  return `<div class="section">
    ${segmentedTabBar(tabs, "orderbook", "perp-book-tab")}
    ${orderBookPanel(mark)}
    ${tradesPanel(mark)}
  </div>`;
};

/** Leverage preset options for a market, defaulting to a conservative middle. */
const leverageOptions = (maxLeverage: number): readonly number[] =>
  Array.from(new Set([2, 5, 10, 20, maxLeverage].filter((value) => value <= maxLeverage))).sort(
    (a, b) => a - b,
  );

/** Estimate tiles derived from the default size + leverage at the mark price. */
const estimates = (mark: number, leverage: number): string => {
  const notional = DEFAULT_SIZE_BASE * mark;
  const margin = notional / leverage;
  const liq = mark * (1 - 1 / leverage);
  const fees = notional * TAKER_FEE_RATE;
  return `<div class="trade-stat-grid">
      ${statPair("Order value", formatUsd(notional))}
      ${statPair("Margin", formatUsd(margin))}
      ${statPair("Liq. price", formatPrice(liq))}
      ${statPair("Est. fees", formatUsd(fees))}
    </div>`;
};

/** Long/Short order ticket for the focused market. */
const orderTicket = (market: PerpMarketRow): string => {
  const sideTabs: readonly SegmentTab[] = [
    { id: "long", label: "Long" },
    { id: "short", label: "Short" },
  ];
  const typeTabs: readonly SegmentTab[] = [
    { id: "market", label: "Market" },
    { id: "limit", label: "Limit" },
  ];
  const options = leverageOptions(market.maxLeverage);
  const defaultLev =
    options.find((value) => value >= 10) ?? options[options.length - 1] ?? market.maxLeverage;
  const levTabs: readonly SegmentTab[] = options.map((value) => ({
    id: String(value),
    label: `${value}x`,
  }));
  return `<div class="section" data-perp-ticket data-perp-protocol="${escapeHtml(extended.EXTENDED_PROTOCOL_ID)}">
    <div class="trade-section-head"><h2>Order</h2><span>${escapeHtml(market.market)}</span></div>
    ${segmentedTabBar(sideTabs, "long", "perp-side")}
    ${segmentedTabBar(typeTabs, "market", "perp-order-type")}
    <label><span>Size (${escapeHtml(market.baseSymbol)})</span><input class="mono" type="text" inputmode="decimal" value="${DEFAULT_SIZE_BASE.toFixed(2)}" data-perp-size /></label>
    <label hidden data-perp-limit-field><span>Limit price (USD)</span><input class="mono" type="text" inputmode="decimal" value="${escapeHtml(market.priceUsd.toString())}" data-perp-limit /></label>
    <div class="stack-tight"><span class="eyebrow">Leverage</span>${segmentedTabBar(levTabs, String(defaultLev), "perp-leverage")}</div>
    ${estimates(market.priceUsd, defaultLev)}
    <button class="option-row" type="button" aria-pressed="false" data-perp-autoclose>
      <span class="option-copy"><strong>Auto-Close (TP / SL)</strong><span class="menu-value">Set take-profit &amp; stop-loss on fill</span></span>
    </button>
    <button type="button" data-perp-submit data-perp-side-value="long">Open long ${escapeHtml(market.baseSymbol)}</button>
  </div>`;
};

/** Position row rendered as a compact card with a P&L pill. */
const positionRow = (row: PositionRow): string =>
  `<li class="trade-row"><div class="trade-row-open">
      <span class="trade-row-copy">
        <strong>${escapeHtml(row.market)}</strong>
        <span class="trade-row-sub">${escapeHtml(`${row.side} · ${row.sizeLabel} · entry ${formatPrice(row.entryUsd)}`)}</span>
      </span>
      <span class="trade-row-trail">${pctChangePill(row.pnlPct)}</span>
      <span class="trade-row-side">
        <span class="trade-row-value">${escapeHtml(signedUsd(row.pnlUsd))}</span>
        <span class="trade-row-valuesub">${escapeHtml(`Liq ${formatPrice(row.liqUsd)}`)}</span>
      </span>
    </div></li>`;

/** Account fill row. */
const fillRow = (row: AccountTrade): string =>
  `<div class="row"><span class="trade-pill ${row.side === "Buy" ? "up" : "down"}">${escapeHtml(
    `${row.side} ${row.market}`,
  )}</span><span class="hint">${escapeHtml(`${row.sizeLabel} @ ${formatPrice(row.priceUsd)} · ${row.time}`)}</span></div>`;

/** Funding payment row. */
const fundingRow = (row: FundingRow): string =>
  `<div class="row"><span class="trade-row-sub">${escapeHtml(`${row.market} · ${signedPct(row.ratePct)}`)}</span><span class="trade-pill ${
    row.amountUsd >= 0 ? "up" : "down"
  }">${escapeHtml(`${signedUsd(row.amountUsd)} · ${row.time}`)}</span></div>`;

/** Historical order row. */
const orderRow = (row: OrderRow): string =>
  `<div class="row"><span class="trade-row-sub">${escapeHtml(
    `${row.side} ${row.type} · ${row.market}`,
  )}</span><span class="hint">${escapeHtml(`${row.sizeLabel} @ ${row.priceLabel} · ${row.status}`)}</span></div>`;

/** Positions / Trades / Funding / Orders account strip. */
const accountStrip = (): string => {
  const tabs: readonly SegmentTab[] = [
    { id: "positions", label: "Positions" },
    { id: "trades", label: "Trades" },
    { id: "funding", label: "Funding" },
    { id: "orders", label: "Orders" },
  ];
  return `<div class="section">
    ${segmentedTabBar(tabs, "positions", "perp-account-tab")}
    <ul class="trade-list" data-perp-account-panel="positions">${SAMPLE_POSITIONS.map(positionRow).join("")}</ul>
    <div class="stack-tight" data-perp-account-panel="trades" hidden>${SAMPLE_ACCOUNT_TRADES.map(fillRow).join("")}</div>
    <div class="stack-tight" data-perp-account-panel="funding" hidden>${SAMPLE_FUNDING.map(fundingRow).join("")}</div>
    <div class="stack-tight" data-perp-account-panel="orders" hidden>${SAMPLE_ORDERS.map(orderRow).join("")}</div>
  </div>`;
};

/**
 * Renders the market-detail drill-in for one perpetual market: header + chart,
 * order book / trades, order ticket, and the account strip. Pure escaped-HTML.
 */
export const renderPerpDetail = (market: PerpMarketRow): string =>
  `<div class="section" data-perp-detail="${escapeHtml(market.id)}">
    <div class="trade-section-head"><h2>${escapeHtml(market.market)}</h2><span>Perpetual</span></div>
    ${detailHeader(market)}
    ${bookSection(market.priceUsd)}
    ${orderTicket(market)}
    ${accountStrip()}
  </div>`;
