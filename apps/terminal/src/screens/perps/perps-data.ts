/**
 * Screen-scoped display mappers + formatters for the Perps screen. All inputs are
 * the REAL Extended models from the data layer (`ExtendedMarket`,
 * `ExtendedMarketStats`, `ExtendedOrderBook`); nothing here fabricates market
 * data. The previous `SAMPLE_MARKETS` fallback array and the synthetic
 * `buildOrderBook` ladder were removed — the order book is now derived from the
 * live WS/REST book, and the markets/stats come straight from Extended.
 */
import type { ExtendedMarket, ExtendedMarketStats, ExtendedOrderBook } from "../../data/index";

// Chooses a sensible number of decimals for a price magnitude.
const priceDigits = (value: number): number => {
  if (value >= 1000) {
    return 1;
  }
  if (value >= 1) {
    return value >= 100 ? 2 : 3;
  }
  return 5;
};

/** Formats a price with magnitude-aware precision (no currency symbol). */
export const fmtPrice = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const digits = priceDigits(value);
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

/** Formats a price with a leading `$`. */
export const fmtUsdPrice = (value: number): string =>
  Number.isFinite(value) ? `$${fmtPrice(value)}` : "—";

/** Formats an order-book size with magnitude-aware precision. */
export const fmtSize = (value: number): string => {
  const digits =
    value >= 1000
      ? 0
      : value >= 1
        ? 2
        : value >= 0.01
          ? 3
          : value >= 0.001
            ? 4
            : 5;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

/** Formats a large USD figure compactly, e.g. `$1.28B`. */
export const fmtCompactUsd = (value: number): string => {
  if (!Number.isFinite(value) || value === 0) {
    return "$0";
  }
  return `$${value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 })}`;
};

/**
 * Converts Extended's absolute daily price delta into a percentage relative to
 * the previous close. The live API returns values such as `1421` for a BTC move
 * from roughly 62.8k to 64.2k; treating it as a fraction produced +142100%.
 */
export const dailyChangePct = (stats: ExtendedMarketStats | null): number => {
  if (stats === null) {
    return 0;
  }
  const current = stats.lastPrice || stats.markPrice;
  const previous = current - stats.dailyPriceChange;
  return previous === 0 ? 0 : (stats.dailyPriceChange / previous) * 100;
};

/**
 * Converts a funding rate (per-interval fraction) into a whole-percent number for
 * display (e.g. 0.0000912 => 0.0091%). Verify the funding interval/units live.
 */
export const fundingPct = (rate: number): number => rate * 100;

/** A perp market shaped for the markets list + header. */
export type PerpMarketRow = {
  readonly symbol: string;
  readonly base: string;
  readonly maxLeverage: number;
  readonly colorIndex: number;
  /** Numeric last/mark price used to seed chart magnitude + book formatting. */
  readonly markValue: number;
  readonly priceLabel: string;
  readonly change24h: number;
  readonly volume24hLabel: string;
  readonly volume24hUsd: number;
  readonly active: boolean;
};

/**
 * Maps a live `ExtendedMarket` (using its nested `marketStats`) onto the display
 * row. Only perpetual markets should be passed in; `type` is checked by the
 * caller when present.
 */
export const toMarketRow = (market: ExtendedMarket, index: number): PerpMarketRow => {
  const stats = market.marketStats;
  const mark = stats !== null ? (stats.lastPrice || stats.markPrice) : 0;
  return {
    symbol: market.name,
    base: market.assetName,
    maxLeverage: Math.max(1, Math.trunc(market.maxLeverage)),
    colorIndex: index,
    markValue: mark,
    priceLabel: fmtUsdPrice(mark),
    change24h: dailyChangePct(stats),
    volume24hLabel: stats !== null ? fmtCompactUsd(stats.dailyVolume) : "—",
    volume24hUsd: stats !== null ? stats.dailyVolume : 0,
    active: market.active,
  };
};

/** One display level of the order book. */
export type OrderBookLevel = {
  readonly price: number;
  readonly size: number;
  readonly total: number;
  /** Cumulative-depth bar width, 0..100. */
  readonly depth: number;
};

/** The order book shaped for the ladder UI. */
export type OrderBookView = {
  readonly asks: readonly OrderBookLevel[];
  readonly bids: readonly OrderBookLevel[];
  readonly midPrice: number;
  readonly spread: number;
  readonly spreadPct: number;
};

/**
 * Derives the display ladder from a LIVE `ExtendedOrderBook`: takes the top
 * `rows` levels per side, accumulates size outward from the touch, and computes
 * depth-bar widths against the larger side's cumulative total. Asks render
 * highest-price-first (walking down to the spread); bids best-first. Returns null
 * when the book has no levels so the screen shows an empty state rather than a
 * fabricated ladder.
 */
export const buildOrderBookView = (
  book: ExtendedOrderBook | null,
  rows = 12,
): OrderBookView | null => {
  if (book === null || (book.bids.length === 0 && book.asks.length === 0)) {
    return null;
  }
  const asksAsc = book.asks.slice(0, rows); // lowest asks, ascending from touch
  const bids = book.bids.slice(0, rows); // highest bids, descending from touch

  const askTotal = asksAsc.reduce((acc, level) => acc + level.qty, 0);
  const bidTotal = bids.reduce((acc, level) => acc + level.qty, 0);
  const maxCum = Math.max(askTotal, bidTotal, 1);

  let cum = 0;
  const asksAscLevels: OrderBookLevel[] = asksAsc.map((level) => {
    cum += level.qty;
    return { price: level.price, size: level.qty, total: cum, depth: (cum / maxCum) * 100 };
  });

  cum = 0;
  const bidLevels: OrderBookLevel[] = bids.map((level) => {
    cum += level.qty;
    return { price: level.price, size: level.qty, total: cum, depth: (cum / maxCum) * 100 };
  });

  const bestAsk = asksAsc[0]?.price ?? 0;
  const bestBid = bids[0]?.price ?? 0;
  const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
  const mid = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : bestAsk || bestBid || 1;

  return {
    asks: [...asksAscLevels].reverse(),
    bids: bidLevels,
    midPrice: mid,
    spread,
    spreadPct: mid > 0 ? (spread / mid) * 100 : 0,
  };
};
