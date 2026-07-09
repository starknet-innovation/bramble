/**
 * Tokens screen (stub). Phase-2 renders the market token list from ./data.ts
 * (SAMPLE_TOKENS) — price, market cap, 24h change pill, and a miniSparkline —
 * then swaps in a live prices feed and swap entry points (ekubo/avnu). The shell
 * already imports and renders this.
 */
import { tradePlaceholder } from "./atoms";
import type { TradeScreenContext } from "./context";

/**
 * Renders the Tokens tab. Fixed call shape: (ctx: TradeScreenContext) => string.
 */
export const renderTokens = (_ctx: TradeScreenContext): string =>
  // TODO(phase2): build the token list from SAMPLE_TOKENS with tradeListRow +
  // miniSparkline + pctChangePill + formatPrice/formatCompactUsd.
  `<section class="trade-panel">${tradePlaceholder("Tokens", "Coming soon")}</section>`;
