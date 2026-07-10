/**
 * Tokens screen: a scrollable market token list (glyph, name/symbol, mini
 * sparkline, 24h change pill, price, market cap) that drills into the token
 * detail view (see ./tokens-detail). The list renders from ./data SAMPLE_TOKENS;
 * each row carries a data-token-open hook that ./tokens-bindings uses to hydrate
 * the detail host below the list. Pure: returns an escaped HTML string, no DOM
 * access. The shell already imports and renders this behind the "tokens" tab.
 */
import { escapeHtml } from "../../shared/html";
import { formatCompactUsd, formatPrice, miniSparkline, pctChangePill, tradeListRow } from "./atoms";
import type { TradeScreenContext } from "./context";
import { SAMPLE_TOKENS, type TokenListItem } from "./data";
import { renderTokenDetail } from "./tokens-detail";

const tokenGlyph = (symbol: string): string =>
  `<span class="trade-glyph">${escapeHtml(symbol.slice(0, 3))}</span>`;

const tokenRow = (token: TokenListItem): string =>
  tradeListRow({
    leading: tokenGlyph(token.symbol),
    title: token.name,
    subtitle: token.symbol,
    trailing: `${miniSparkline(token.sparkline)}${pctChangePill(token.change24hPct)}`,
    value: formatPrice(token.priceUsd),
    valueSub: formatCompactUsd(token.marketCapUsd),
    action: { attr: "token-open", value: token.id },
  });

const detailHost = (token: TokenListItem): string =>
  `<div class="trade-tokens-detail" data-token-detail-host="${escapeHtml(token.id)}" hidden>${renderTokenDetail(token)}</div>`;

/**
 * Renders the Tokens tab. Fixed call shape: (ctx: TradeScreenContext) => string.
 * The list is shown first; one detail host per token is pre-rendered hidden and
 * toggled on drill-in by the binder (mirrors the shell's tab-host toggling), so
 * no runtime HTML injection is needed.
 */
export const renderTokens = (_ctx: TradeScreenContext): string =>
  `<section class="trade-panel">
    <div class="trade-tokens" data-tokens-view="list">
      <div class="trade-section-head"><h2>Tokens</h2><span>${SAMPLE_TOKENS.length} markets</span></div>
      <ul class="trade-list">${SAMPLE_TOKENS.map(tokenRow).join("")}</ul>
    </div>
    ${SAMPLE_TOKENS.map(detailHost).join("")}
  </section>`;
