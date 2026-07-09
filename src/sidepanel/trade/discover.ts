/**
 * Discover screen (stub). Phase-2 renders the launches/trending feed from
 * ./data.ts (SAMPLE_LAUNCHES) using the shared atoms, and later swaps the
 * sample data for a live feed. The shell already imports and renders this.
 */
import { tradePlaceholder } from "./atoms";
import type { TradeScreenContext } from "./context";

/**
 * Renders the Discover tab. Fixed call shape: (ctx: TradeScreenContext) => string.
 */
export const renderDiscover = (_ctx: TradeScreenContext): string =>
  // TODO(phase2): build the launches list from SAMPLE_LAUNCHES with tradeListRow
  // + pctChangePill + formatCompactUsd, then wire a live discover feed.
  `<section class="trade-panel">${tradePlaceholder("Discover", "Coming soon")}</section>`;
