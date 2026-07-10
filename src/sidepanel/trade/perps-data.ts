/**
 * Typed shapes and HARDCODED sample data for the Perps market-detail drill-in
 * (order book, recent trades, and the account Positions/Trades/Funding/Orders
 * strip). Every value is a literal — no clocks, no randomness — so the scaffold
 * renders deterministically; price-relative figures (book/tape) are expressed as
 * basis-point offsets the detail renderer applies to the focused market's mark
 * price. A later pass swaps these arrays for live Extended feeds behind the same
 * shapes, so screens should depend on the types, not the literals.
 */

/**
 * One order-book level, expressed as a basis-point offset from the mark price
 * (applied by the renderer) plus a base-asset size.
 */
export type BookLevel = {
  readonly offsetBps: number;
  readonly size: number;
};

/**
 * One printed trade on the recent-trades tape: taker side, a basis-point offset
 * from mark, a base-asset size, and a pre-rendered wall-clock label (a literal
 * string so no time math — banned in src/ — is needed).
 */
export type TapeEntry = {
  readonly side: "buy" | "sell";
  readonly offsetBps: number;
  readonly size: number;
  readonly time: string;
};

/**
 * One open perp position in the account strip.
 */
export type PositionRow = {
  readonly id: string;
  readonly market: string;
  readonly side: "Long" | "Short";
  readonly sizeLabel: string;
  readonly entryUsd: number;
  readonly liqUsd: number;
  readonly pnlUsd: number;
  readonly pnlPct: number;
};

/**
 * One settled account trade (fill) in the account strip.
 */
export type AccountTrade = {
  readonly id: string;
  readonly market: string;
  readonly side: "Buy" | "Sell";
  readonly sizeLabel: string;
  readonly priceUsd: number;
  readonly time: string;
};

/**
 * One funding payment row in the account strip.
 */
export type FundingRow = {
  readonly id: string;
  readonly market: string;
  readonly ratePct: number;
  readonly amountUsd: number;
  readonly time: string;
};

/**
 * One historical order row in the account strip.
 */
export type OrderRow = {
  readonly id: string;
  readonly market: string;
  readonly type: "Limit" | "Market";
  readonly side: "Buy" | "Sell";
  readonly sizeLabel: string;
  readonly priceLabel: string;
  readonly status: "Filled" | "Canceled" | "Open";
};

/**
 * Sample price series (unitless samples, oldest -> newest) driving the detail
 * trend chart; the renderer reverses it for markets trading down so the trend
 * color tracks the 24h change.
 */
export const PERP_CHART: readonly number[] = [
  61200, 61850, 61540, 62210, 62980, 62640, 63410, 64080, 63720, 64560, 65210, 66040, 65780, 66720,
  67310, 67910,
];

/**
 * Sample per-interval volume buckets driving the detail volume mini bar chart.
 */
export const PERP_VOLUME_BARS: readonly number[] = [12, 18, 9, 22, 15, 27, 19, 31, 24, 20, 28, 34];

/**
 * Sample ask levels, ordered far -> near so they render top-down toward the
 * spread. Prices are mark * (1 + offsetBps / 10000).
 */
export const ASK_LEVELS: readonly BookLevel[] = [
  { offsetBps: 26, size: 3.18 },
  { offsetBps: 18, size: 1.42 },
  { offsetBps: 11, size: 2.07 },
  { offsetBps: 6, size: 0.94 },
  { offsetBps: 3, size: 1.35 },
  { offsetBps: 1, size: 0.52 },
];

/**
 * Sample bid levels, ordered near -> far below the spread. Prices are
 * mark * (1 - offsetBps / 10000).
 */
export const BID_LEVELS: readonly BookLevel[] = [
  { offsetBps: 1, size: 0.61 },
  { offsetBps: 4, size: 1.12 },
  { offsetBps: 8, size: 0.88 },
  { offsetBps: 13, size: 2.24 },
  { offsetBps: 19, size: 1.51 },
  { offsetBps: 27, size: 3.02 },
];

/**
 * Sample recent-trades tape, newest first.
 */
export const TAPE: readonly TapeEntry[] = [
  { side: "buy", offsetBps: 2, size: 0.14, time: "12:04:31" },
  { side: "sell", offsetBps: -1, size: 0.32, time: "12:04:27" },
  { side: "buy", offsetBps: 3, size: 0.08, time: "12:04:19" },
  { side: "buy", offsetBps: 1, size: 0.51, time: "12:04:11" },
  { side: "sell", offsetBps: -4, size: 0.22, time: "12:03:58" },
  { side: "sell", offsetBps: -2, size: 0.17, time: "12:03:44" },
  { side: "buy", offsetBps: 5, size: 0.63, time: "12:03:30" },
];

/**
 * Sample open positions for the account strip.
 */
export const SAMPLE_POSITIONS: readonly PositionRow[] = [
  {
    id: "pos-btc",
    market: "BTC-USD",
    side: "Long",
    sizeLabel: "0.150 BTC",
    entryUsd: 65120,
    liqUsd: 58680,
    pnlUsd: 418.75,
    pnlPct: 6.42,
  },
  {
    id: "pos-eth",
    market: "ETH-USD",
    side: "Short",
    sizeLabel: "3.00 ETH",
    entryUsd: 3210,
    liqUsd: 3612,
    pnlUsd: -128.4,
    pnlPct: -3.19,
  },
];

/**
 * Sample account fills for the account strip.
 */
export const SAMPLE_ACCOUNT_TRADES: readonly AccountTrade[] = [
  {
    id: "fill-1",
    market: "BTC-USD",
    side: "Buy",
    sizeLabel: "0.050 BTC",
    priceUsd: 67840,
    time: "11:58",
  },
  {
    id: "fill-2",
    market: "ETH-USD",
    side: "Sell",
    sizeLabel: "1.00 ETH",
    priceUsd: 3126,
    time: "11:41",
  },
  {
    id: "fill-3",
    market: "BTC-USD",
    side: "Buy",
    sizeLabel: "0.100 BTC",
    priceUsd: 65120,
    time: "10:12",
  },
];

/**
 * Sample funding payments for the account strip.
 */
export const SAMPLE_FUNDING: readonly FundingRow[] = [
  { id: "fund-1", market: "BTC-USD", ratePct: 0.012, amountUsd: -1.84, time: "12:00" },
  { id: "fund-2", market: "ETH-USD", ratePct: -0.006, amountUsd: 0.57, time: "12:00" },
  { id: "fund-3", market: "BTC-USD", ratePct: 0.009, amountUsd: -1.32, time: "04:00" },
];

/**
 * Sample historical orders for the account strip.
 */
export const SAMPLE_ORDERS: readonly OrderRow[] = [
  {
    id: "ord-1",
    market: "BTC-USD",
    type: "Limit",
    side: "Buy",
    sizeLabel: "0.050 BTC",
    priceLabel: "$65,000.00",
    status: "Filled",
  },
  {
    id: "ord-2",
    market: "STRK-USD",
    type: "Market",
    side: "Buy",
    sizeLabel: "5,000 STRK",
    priceLabel: "Market",
    status: "Filled",
  },
  {
    id: "ord-3",
    market: "ETH-USD",
    type: "Limit",
    side: "Sell",
    sizeLabel: "2.00 ETH",
    priceLabel: "$3,400.00",
    status: "Canceled",
  },
];
