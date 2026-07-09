/**
 * Perps screen (stub). Phase-2 renders the perpetual markets list from
 * ./data.ts (SAMPLE_PERPS) — price, 24h change, max leverage, funding — then
 * swaps in Extended's live markets and the sign-order flow. The shell already
 * imports and renders this.
 */
import { tradePlaceholder } from "./atoms";
import type { TradeScreenContext } from "./context";

/**
 * Renders the Perps tab. Fixed call shape: (ctx: TradeScreenContext) => string.
 */
export const renderPerps = (_ctx: TradeScreenContext): string =>
  // TODO(phase2): build the markets list from SAMPLE_PERPS with tradeListRow +
  // pctChangePill + statPair, then wire extended.fetchMarkets/signOrder.
  `<section class="trade-panel">${tradePlaceholder("Perps", "Coming soon")}</section>`;
