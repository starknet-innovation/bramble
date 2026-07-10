/**
 * Token detail view for the trade terminal's Tokens screen. Renders the drilled-
 * in view for a single token: a price/market-cap stat header, an inline-SVG
 * price chart, a Buy/Sell swap panel (amount input + quick-amount chips + a quote
 * readout wired via data-* to the ekubo/avnu protocol layer by ./tokens-bindings),
 * a token-info/security block, and Trades/Holders tabs. Pure: returns an escaped
 * HTML string built from ./data sample tokens plus the deterministic literal
 * metadata below; a later pass swaps the literals for live feeds behind the same
 * shapes. The binder hydrates this string into the detail host on drill-in.
 */
import { escapeHtml } from "../../shared/html";
import { icon } from "../icons";
import {
  formatCompactUsd,
  formatPrice,
  formatUsd,
  miniSparkline,
  pctChangePill,
  type SegmentTab,
  segmentedTabBar,
  statPair,
  tradeListRow,
} from "./atoms";
import type { TokenListItem } from "./data";

/**
 * Non-price security/quality metadata shown in the token-info block. Hardcoded
 * per token below; the shape is the contract for a later on-chain scanner feed.
 */
export type TokenSecurityMeta = {
  readonly holders: number;
  readonly top10Pct: number;
  readonly lpBurned: boolean;
  readonly mintDisabled: boolean;
  readonly freezeDisabled: boolean;
  readonly devWalletPct: number;
};

const SECURITY_META: Readonly<Record<string, TokenSecurityMeta>> = {
  "token-eth": {
    holders: 980000,
    top10Pct: 22.6,
    lpBurned: true,
    mintDisabled: true,
    freezeDisabled: true,
    devWalletPct: 0.4,
  },
  "token-strk": {
    holders: 412000,
    top10Pct: 38.4,
    lpBurned: true,
    mintDisabled: true,
    freezeDisabled: true,
    devWalletPct: 2.1,
  },
  "token-usdc": {
    holders: 210000,
    top10Pct: 44.1,
    lpBurned: true,
    mintDisabled: false,
    freezeDisabled: false,
    devWalletPct: 0.2,
  },
  "token-usdt": {
    holders: 178000,
    top10Pct: 49.7,
    lpBurned: true,
    mintDisabled: false,
    freezeDisabled: false,
    devWalletPct: 0.3,
  },
  "token-wbtc": {
    holders: 54000,
    top10Pct: 61.2,
    lpBurned: false,
    mintDisabled: true,
    freezeDisabled: false,
    devWalletPct: 4.8,
  },
};

const DEFAULT_META: TokenSecurityMeta = {
  holders: 12400,
  top10Pct: 42.5,
  lpBurned: true,
  mintDisabled: true,
  freezeDisabled: true,
  devWalletPct: 3.2,
};

type TradeTemplate = {
  readonly id: string;
  readonly side: "buy" | "sell";
  readonly amountUsd: number;
  readonly priceMul: number;
  readonly ageLabel: string;
  readonly account: string;
};

const TRADE_TEMPLATE: readonly TradeTemplate[] = [
  {
    id: "t1",
    side: "buy",
    amountUsd: 1250,
    priceMul: 1.001,
    ageLabel: "12s",
    account: "0x04a3…9f21",
  },
  {
    id: "t2",
    side: "sell",
    amountUsd: 480,
    priceMul: 0.999,
    ageLabel: "48s",
    account: "0x071c…2b0d",
  },
  {
    id: "t3",
    side: "buy",
    amountUsd: 3200,
    priceMul: 1.004,
    ageLabel: "2m",
    account: "0x0559…8a17",
  },
  {
    id: "t4",
    side: "sell",
    amountUsd: 910,
    priceMul: 0.997,
    ageLabel: "5m",
    account: "0x03fe…7ac0",
  },
];

type HolderTemplate = {
  readonly id: string;
  readonly rank: number;
  readonly label: string;
  readonly address: string;
  readonly pct: number;
};

const HOLDER_TEMPLATE: readonly HolderTemplate[] = [
  { id: "h1", rank: 1, label: "Liquidity pool", address: "0x0199…737e", pct: 18.4 },
  { id: "h2", rank: 2, label: "Treasury", address: "0x04a3…9f21", pct: 9.2 },
  { id: "h3", rank: 3, label: "Whale", address: "0x071c…2b0d", pct: 6.7 },
  { id: "h4", rank: 4, label: "Market maker", address: "0x0559…8a17", pct: 4.1 },
  { id: "h5", rank: 5, label: "Community fund", address: "0x03fe…7ac0", pct: 2.8 },
];

const QUICK_AMOUNTS: readonly string[] = ["10", "50", "100", "500"];

const round1 = (value: number): number => Math.round(value * 10) / 10;

const compactNumber = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `${round1(value / 1_000_000_000)}B`;
  }
  if (abs >= 1_000_000) {
    return `${round1(value / 1_000_000)}M`;
  }
  if (abs >= 1_000) {
    return `${round1(value / 1_000)}K`;
  }
  return `${Math.round(value)}`;
};

const formatPct = (pct: number): string => `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;

const formatShare = (pct: number): string => `${pct.toFixed(1)}%`;

const shortAddress = (address: string): string =>
  address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;

const detailHeader = (token: TokenListItem): string =>
  `<div class="trade-header">
    <button class="icon-button ghost" type="button" data-token-back aria-label="Back to tokens" title="Back to tokens">${icon("chevronLeft")}</button>
    <h1>${escapeHtml(token.name)}</h1>
    ${pctChangePill(token.change24hPct)}
  </div>`;

const detailStats = (token: TokenListItem, meta: TokenSecurityMeta): string => {
  const supply = token.priceUsd > 0 ? token.marketCapUsd / token.priceUsd : 0;
  const liquidityUsd = token.marketCapUsd * 0.06;
  return `<div class="trade-stat-grid">
    ${statPair("Price", formatPrice(token.priceUsd))}
    ${statPair("Market cap", formatCompactUsd(token.marketCapUsd))}
    ${statPair("24h change", formatPct(token.change24hPct))}
    ${statPair("Liquidity", formatCompactUsd(liquidityUsd))}
    ${statPair("Supply", `${compactNumber(supply)} ${token.symbol}`)}
    ${statPair("Holders", compactNumber(meta.holders))}
  </div>`;
};

const detailChart = (token: TokenListItem): string =>
  `<div class="trade-stat trade-chart">
    <span class="trade-stat-label">Price trend</span>
    ${miniSparkline(token.sparkline, { height: 64, width: 240 })}
  </div>`;

const detailSwap = (token: TokenListItem): string => {
  const sides: readonly SegmentTab[] = [
    { id: "buy", label: "Buy" },
    { id: "sell", label: "Sell" },
  ];
  const chips = QUICK_AMOUNTS.map(
    (amount) =>
      `<button class="trade-seg" type="button" data-token-quick="${escapeHtml(amount)}">${escapeHtml(amount)}</button>`,
  ).join("");
  return `<div class="trade-swap">
    ${segmentedTabBar(sides, "buy", "token-side")}
    <label>
      <span data-token-pay-label>You pay (USDC)</span>
      <input class="mono" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="0.00" data-token-amount aria-label="Amount to swap">
    </label>
    <div class="trade-seg-bar" role="group" aria-label="Quick amounts">${chips}</div>
    <p class="hint" role="status" data-token-quote>Enter an amount to see a quote.</p>
    <button type="button" data-token-swap="${escapeHtml(token.id)}" disabled>Review swap</button>
  </div>`;
};

const detailInfo = (token: TokenListItem, meta: TokenSecurityMeta): string =>
  `<div>
    <div class="trade-section-head"><h2>Token info</h2></div>
    <div class="trade-stat-grid">
      ${statPair("Top 10 hold", formatShare(meta.top10Pct))}
      ${statPair("LP burned", meta.lpBurned ? "Yes" : "No")}
      ${statPair("Mint", meta.mintDisabled ? "Disabled" : "Enabled")}
      ${statPair("Freeze", meta.freezeDisabled ? "Disabled" : "Enabled")}
      ${statPair("Dev wallet", formatShare(meta.devWalletPct))}
      ${statPair("Contract", shortAddress(token.address))}
    </div>
  </div>`;

const tradeRow = (token: TokenListItem, template: TradeTemplate): string => {
  const glyph = template.side === "buy" ? "up" : "down";
  const arrow = template.side === "buy" ? "↑" : "↓";
  return tradeListRow({
    title: template.side === "buy" ? "Buy" : "Sell",
    subtitle: template.account,
    trailing: `<span class="trade-pill ${glyph}">${arrow} ${escapeHtml(template.ageLabel)}</span>`,
    value: formatUsd(template.amountUsd),
    valueSub: formatPrice(token.priceUsd * template.priceMul),
  });
};

const holderRow = (template: HolderTemplate): string =>
  tradeListRow({
    leading: `<span class="trade-glyph">#${template.rank}</span>`,
    title: template.label,
    subtitle: shortAddress(template.address),
    value: formatShare(template.pct),
  });

const detailActivity = (token: TokenListItem): string => {
  const tabs: readonly SegmentTab[] = [
    { id: "trades", label: "Trades" },
    { id: "holders", label: "Holders" },
  ];
  const trades = TRADE_TEMPLATE.map((template) => tradeRow(token, template)).join("");
  const holders = HOLDER_TEMPLATE.map(holderRow).join("");
  return `<div>
    ${segmentedTabBar(tabs, "trades", "token-tab")}
    <div data-token-tabpanel="trades"><ul class="trade-list">${trades}</ul></div>
    <div data-token-tabpanel="holders" hidden><ul class="trade-list">${holders}</ul></div>
  </div>`;
};

/**
 * Renders the full token detail view for one token as an escaped HTML string.
 * The Buy/Sell, quick-amount, and Trades/Holders controls emit data-* hooks that
 * ./tokens-bindings wires; no event handlers are inlined.
 */
export const renderTokenDetail = (token: TokenListItem): string => {
  const meta = SECURITY_META[token.id] ?? DEFAULT_META;
  return `<div class="trade-panel" data-token-detail="${escapeHtml(token.id)}">
    ${detailHeader(token)}
    ${detailStats(token, meta)}
    ${detailChart(token)}
    ${detailSwap(token)}
    ${detailInfo(token, meta)}
    ${detailActivity(token)}
  </div>`;
};
