/**
 * Portfolio screen: the trade terminal's holdings view, adapting Phantom's
 * portfolio to the ~380px side panel. A balance hero shows the total value and
 * 24h P&L with Total / Tokens / Perps sub-tabs that swap the headline figure,
 * a compact stat grid, then a tab strip (Tokens / Perps / Token Activity /
 * Perps Activity / Top Movers) over pre-rendered, individually-hidden panels.
 * Holdings come from the hardcoded SAMPLE_PORTFOLIO literals in ./data today;
 * a later pass swaps those for live balances/prices behind the same shapes.
 * When no wallet account is active the screen collapses to a "No wallet
 * detected" empty state; otherwise the connected account is shown in the hero.
 * Pure: returns an escaped-HTML string. Sub-tab/tab switching is client-side via
 * the data-* hooks ./portfolio-bindings wires; no event handlers are inlined.
 */
import type { WalletStatus } from "../../popup/responses";
import { escapeHtml } from "../../shared/html";
import {
  formatUsd,
  miniSparkline,
  pctChangePill,
  type SegmentTab,
  segmentedTabBar,
  statPair,
  tradeListRow,
  tradePlaceholder,
} from "./atoms";
import type { TradeScreenContext } from "./context";
import {
  type PortfolioPosition,
  type PortfolioSummary,
  SAMPLE_PORTFOLIO,
  SAMPLE_TOKENS,
} from "./data";
import { renderPerpActivity, renderTokenActivity } from "./portfolio-activity";

/**
 * Resolves the active account's on-chain address, or null when no account is
 * selected (drives the empty state).
 */
const activeAddress = (status: WalletStatus): string | null =>
  status.accounts.find((account) => account.id === status.activeAccountId)?.address ?? null;

/**
 * Renders a round token mark from a symbol's leading letters, escaped for the
 * row `leading` slot.
 */
const glyph = (symbol: string): string =>
  `<span class="trade-glyph">${escapeHtml(symbol.slice(0, 3).toUpperCase())}</span>`;

/**
 * Shortens a 0x address for display (e.g. 0x04a3…9f21).
 */
const shortAddress = (address: string): string =>
  address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;

/**
 * Formats a signed fiat P&L string (e.g. "+$426.83" / "-$12.00").
 */
const signedUsd = (value: number): string =>
  `${value >= 0 ? "+" : "-"}${formatUsd(Math.abs(value))}`;

/**
 * Formats a token unit amount with grouping (e.g. 18000 -> "18,000").
 */
const formatAmount = (amount: number): string =>
  amount.toLocaleString("en-US", { maximumFractionDigits: 4 });

/**
 * Looks up a token's sample sparkline by symbol, or an empty series (which the
 * mini chart renders as nothing) when the symbol is not in the sample set.
 */
const sparkFor = (symbol: string): readonly number[] =>
  SAMPLE_TOKENS.find((token) => token.symbol === symbol)?.sparkline ?? [];

/**
 * One scope of the balance hero: the headline total and a 24h pill, toggled by
 * the Total / Tokens / Perps sub-tab bar.
 */
const scopePanel = (id: string, value: number, changePct: number, active: boolean): string =>
  `<div class="trade-hero-scope" data-portfolio-scope-panel="${id}"${active ? "" : " hidden"}>
    <span class="trade-hero-total">${escapeHtml(formatUsd(value))}</span>
    <span>${pctChangePill(changePct)} <span class="trade-row-sub">Past 24h</span></span>
  </div>`;

/**
 * Balance hero: connected account, the Total / Tokens / Perps scope bar, and one
 * headline scope panel per sub-tab (only the active one visible).
 */
const balanceHero = (
  address: string,
  summary: PortfolioSummary,
  tokensValue: number,
  perpsValue: number,
): string => {
  const scopeTabs: readonly SegmentTab[] = [
    { id: "total", label: "Total" },
    { id: "tokens", label: "Tokens" },
    { id: "perps", label: "Perps" },
  ];
  return `<div class="trade-hero">
    <span class="trade-row-sub">${escapeHtml(shortAddress(address))}</span>
    ${segmentedTabBar(scopeTabs, "total", "portfolio-scope")}
    ${scopePanel("total", summary.totalValueUsd, summary.change24hPct, true)}
    ${scopePanel("tokens", tokensValue, summary.change24hPct, false)}
    ${scopePanel("perps", perpsValue, 0, false)}
  </div>`;
};

/**
 * Compact stat grid beneath the hero: available cash, 24h P&L, and open-position
 * count.
 */
const statGrid = (summary: PortfolioSummary, pnlUsd: number): string =>
  `<div class="trade-stat-grid">
    ${statPair("Available", formatUsd(summary.availableUsd))}
    ${statPair("24h P&L", signedUsd(pnlUsd))}
    ${statPair("Positions", String(summary.positions.length))}
  </div>`;

/**
 * One holding row: token mark, name, held amount, sparkline + 24h pill, and fiat
 * value. The row button carries a data-portfolio-position hook for a later
 * detail route.
 */
const positionRow = (position: PortfolioPosition): string =>
  tradeListRow({
    action: { attr: "portfolio-position", value: position.id },
    leading: glyph(position.symbol),
    subtitle: `${formatAmount(position.amount)} ${position.symbol}`,
    title: position.name,
    trailing: `${miniSparkline(sparkFor(position.symbol))}${pctChangePill(position.change24hPct)}`,
    value: formatUsd(position.valueUsd),
  });

/**
 * Renders a section heading (mirrors the shell's .trade-section-head).
 */
const sectionHead = (title: string): string =>
  `<div class="trade-section-head"><h2>${escapeHtml(title)}</h2></div>`;

/**
 * Tokens tab body: the list of token holdings, or a placeholder when empty.
 */
const tokensPanel = (positions: readonly PortfolioPosition[]): string =>
  positions.length === 0
    ? tradePlaceholder("No tokens", "Your token holdings will appear here.")
    : `<ul class="trade-list">${positions.map(positionRow).join("")}</ul>`;

/**
 * Perps tab body. The sample portfolio holds no perps, so this is a placeholder
 * until live perp positions land behind the same shapes.
 */
const perpsPanel = (): string =>
  tradePlaceholder("No open perps", "Open a position from the Perps tab to see it here.");

/**
 * Top Movers tab body: the best- and worst-performing holdings over 24h.
 */
const moversPanel = (positions: readonly PortfolioPosition[]): string => {
  const [first, ...rest] = positions;
  if (first === undefined) {
    return tradePlaceholder("No movers yet", "Holdings ranked by 24h change will appear here.");
  }
  let gainer = first;
  let loser = first;
  for (const position of rest) {
    if (position.change24hPct > gainer.change24hPct) {
      gainer = position;
    }
    if (position.change24hPct < loser.change24hPct) {
      loser = position;
    }
  }
  return `${sectionHead("Top gainer")}
    <ul class="trade-list">${positionRow(gainer)}</ul>
    ${sectionHead("Top loser")}
    <ul class="trade-list">${positionRow(loser)}</ul>`;
};

/**
 * Wraps one tab's body in its host; only the active tab's host is visible, and
 * ./portfolio-bindings toggles the rest on tab clicks.
 */
const tabPanel = (id: string, body: string, active: boolean): string =>
  `<div data-portfolio-tab-panel="${id}"${active ? "" : " hidden"}>${body}</div>`;

/**
 * Renders the Portfolio tab. Fixed call shape: (ctx: TradeScreenContext) => string.
 * All sub-tab and tab panels are pre-rendered (hidden but for the active one) so
 * switching needs no re-render, mirroring the shell's tab-host toggling.
 */
export const renderPortfolio = (ctx: TradeScreenContext): string => {
  const address = activeAddress(ctx.status);
  if (address === null) {
    return `<section class="trade-panel">${tradePlaceholder(
      "No wallet detected",
      "Create or unlock a wallet to view your portfolio.",
    )}</section>`;
  }
  const summary = SAMPLE_PORTFOLIO;
  const tokensValue = summary.positions.reduce((total, position) => total + position.valueUsd, 0);
  const perpsValue = Math.max(summary.totalValueUsd - tokensValue, 0);
  const pnlUsd = summary.totalValueUsd * (summary.change24hPct / 100);
  const tabs: readonly SegmentTab[] = [
    { id: "tokens", label: "Tokens" },
    { id: "perps", label: "Perps" },
    { id: "token-activity", label: "Token Activity" },
    { id: "perps-activity", label: "Perps Activity" },
    { id: "movers", label: "Top Movers" },
  ];
  return `<section class="trade-panel">
    ${balanceHero(address, summary, tokensValue, perpsValue)}
    ${statGrid(summary, pnlUsd)}
    ${segmentedTabBar(tabs, "tokens", "portfolio-tab")}
    ${tabPanel("tokens", tokensPanel(summary.positions), true)}
    ${tabPanel("perps", perpsPanel(), false)}
    ${tabPanel("token-activity", renderTokenActivity(), false)}
    ${tabPanel("perps-activity", renderPerpActivity(), false)}
    ${tabPanel("movers", moversPanel(summary.positions), false)}
  </section>`;
};
