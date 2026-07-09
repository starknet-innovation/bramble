/**
 * Portfolio screen (stub). Phase-2 renders the portfolio summary from ./data.ts
 * (SAMPLE_PORTFOLIO) — total value hero, 24h change, positions list — then swaps
 * in live balances/prices and lending (vesu) + privacy positions. The shell
 * already imports and renders this.
 */
import { tradePlaceholder } from "./atoms";
import type { TradeScreenContext } from "./context";

/**
 * Renders the Portfolio tab. Fixed call shape: (ctx: TradeScreenContext) => string.
 */
export const renderPortfolio = (_ctx: TradeScreenContext): string =>
  // TODO(phase2): build the summary from SAMPLE_PORTFOLIO with the trade-hero,
  // statPair grid, and a positions list of tradeListRow + pctChangePill.
  `<section class="trade-panel">${tradePlaceholder("Portfolio", "Coming soon")}</section>`;
