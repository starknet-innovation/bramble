/**
 * Trade terminal shell: the top-level surface reached from the wallet's Trade
 * entry point. Renders a back-to-wallet control, the Discover / Tokens / Perps /
 * Portfolio tab nav (mirroring Phantom), and one host per screen. Each screen's
 * render function is imported from its own module and called with the shared
 * TradeScreenContext; only the active tab's host is visible, and the active tab
 * is toggled client-side by bindTrade (see ./bindings.ts) without a re-render.
 */
import { icon } from "../icons";
import { type SegmentTab, segmentedTabBar } from "./atoms";
import { TRADE_TABS, type TradeScreenContext, type TradeTab } from "./context";
import { renderDiscover } from "./discover";
import { renderPerps } from "./perps";
import { renderPortfolio } from "./portfolio";
import { renderTokens } from "./tokens";

const TAB_LABELS: Readonly<Record<TradeTab, string>> = {
  discover: "Discover",
  perps: "Perps",
  portfolio: "Portfolio",
  tokens: "Tokens",
};

const RENDERERS: Readonly<Record<TradeTab, (ctx: TradeScreenContext) => string>> = {
  discover: renderDiscover,
  perps: renderPerps,
  portfolio: renderPortfolio,
  tokens: renderTokens,
};

const panelHost = (tab: TradeTab, activeTab: TradeTab, body: string): string =>
  `<div class="trade-panel-host" data-trade-panel="${tab}"${tab === activeTab ? "" : " hidden"}>${body}</div>`;

/**
 * Renders the full trade terminal for the active tab. The back control returns
 * to the wallet home; the segmented bar and panel hosts carry the data-* hooks
 * bindTrade wires. Fixed call shape: (activeTab, ctx) => string.
 */
export const tradeTerminal = (activeTab: TradeTab, ctx: TradeScreenContext): string => {
  const segTabs: readonly SegmentTab[] = TRADE_TABS.map((id) => ({ id, label: TAB_LABELS[id] }));
  const hosts = TRADE_TABS.map((tab) => panelHost(tab, activeTab, RENDERERS[tab](ctx))).join("");
  return `<main class="screen trade-terminal" id="wallet-screen-trade" tabindex="-1">
    <header class="trade-header">
      <button class="icon-button ghost" data-view="home" type="button" aria-label="Back to wallet" title="Back to wallet">${icon("chevronLeft")}</button>
      <h1>Trade</h1>
    </header>
    ${segmentedTabBar(segTabs, activeTab, "trade-tab")}
    ${hosts}
  </main>`;
};
