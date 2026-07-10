/**
 * Screen-scoped sample data + helpers for the Perps screen. Extended is
 * region-gated (its markets read can throw), so these samples are the fallback
 * the UI renders when `extended.fetchMarkets()` is unavailable, and the order
 * book ladder is synthesized locally from the selected market's mark price.
 */
import type { PerpMarketInfo } from "../protocols";

/** A perp market shaped for display (richer than the shared PerpMarketInfo). */
export type PerpMarket = {
  readonly symbol: string;
  readonly base: string;
  readonly price: string;
  readonly change24h: number;
  readonly maxLeverage: number;
  readonly mark: string;
  readonly oracle: string;
  readonly volume24h: string;
  readonly funding: number;
  readonly openInterest: string;
  /** Numeric mark price used to seed the chart + order book. */
  readonly markValue: number;
  /** Palette seed for the icon gradient. */
  readonly gradientIndex: number;
};

/** Fallback markets used whenever the region-gated Extended API is unavailable. */
export const SAMPLE_MARKETS: readonly PerpMarket[] = [
  {
    symbol: "BTC-USD",
    base: "BTC",
    price: "$63,842",
    change24h: 2.14,
    maxLeverage: 40,
    mark: "$63,842.5",
    oracle: "$63,830.1",
    volume24h: "$1.28B",
    funding: 0.0091,
    openInterest: "$418.6M",
    markValue: 63842.5,
    gradientIndex: 5,
  },
  {
    symbol: "ETH-USD",
    base: "ETH",
    price: "$3,284",
    change24h: 1.8,
    maxLeverage: 40,
    mark: "$3,284.1",
    oracle: "$3,283.4",
    volume24h: "$842.1M",
    funding: 0.0072,
    openInterest: "$212.4M",
    markValue: 3284.1,
    gradientIndex: 1,
  },
  {
    symbol: "SOL-USD",
    base: "SOL",
    price: "$168.4",
    change24h: -4.2,
    maxLeverage: 20,
    mark: "$168.42",
    oracle: "$168.51",
    volume24h: "$318.9M",
    funding: -0.0043,
    openInterest: "$96.2M",
    markValue: 168.42,
    gradientIndex: 4,
  },
  {
    symbol: "STRK-USD",
    base: "STRK",
    price: "$0.1428",
    change24h: 6.34,
    maxLeverage: 10,
    mark: "$0.14281",
    oracle: "$0.14275",
    volume24h: "$41.6M",
    funding: 0.0118,
    openInterest: "$12.8M",
    markValue: 0.14281,
    gradientIndex: 0,
  },
  {
    symbol: "SUI-USD",
    base: "SUI",
    price: "$1.842",
    change24h: 9.1,
    maxLeverage: 20,
    mark: "$1.8421",
    oracle: "$1.8409",
    volume24h: "$58.3M",
    funding: 0.021,
    openInterest: "$18.1M",
    markValue: 1.8421,
    gradientIndex: 6,
  },
  {
    symbol: "DOGE-USD",
    base: "DOGE",
    price: "$0.1621",
    change24h: -1.4,
    maxLeverage: 20,
    mark: "$0.16211",
    oracle: "$0.16218",
    volume24h: "$77.4M",
    funding: -0.0031,
    openInterest: "$24.9M",
    markValue: 0.16211,
    gradientIndex: 2,
  },
  {
    symbol: "AVAX-USD",
    base: "AVAX",
    price: "$36.28",
    change24h: 3.3,
    maxLeverage: 15,
    mark: "$36.281",
    oracle: "$36.274",
    volume24h: "$29.7M",
    funding: 0.0064,
    openInterest: "$9.4M",
    markValue: 36.281,
    gradientIndex: 3,
  },
  {
    symbol: "LINK-USD",
    base: "LINK",
    price: "$18.92",
    change24h: -2.7,
    maxLeverage: 20,
    mark: "$18.921",
    oracle: "$18.928",
    volume24h: "$21.4M",
    funding: -0.0018,
    openInterest: "$7.1M",
    markValue: 18.921,
    gradientIndex: 7,
  },
];

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

const formatPrice = (value: number): string =>
  `$${value.toLocaleString("en-US", {
    minimumFractionDigits: priceDigits(value),
    maximumFractionDigits: priceDigits(value),
  })}`;

/**
 * Maps a region-gated Extended `PerpMarketInfo` onto the richer display shape.
 * The shared contract carries no 24h change / mark-oracle split / volume, so
 * those are derived or shown as placeholders.
 */
export const toPerpMarket = (info: PerpMarketInfo, index: number): PerpMarket => {
  const markValue = Number.parseFloat(info.lastPrice);
  const safeMark = Number.isFinite(markValue) ? markValue : 0;
  const funding = Number.parseFloat(info.fundingRate);
  return {
    symbol: info.name,
    base: info.baseAsset,
    price: formatPrice(safeMark),
    change24h: 0,
    maxLeverage: info.maxLeverage,
    mark: formatPrice(safeMark),
    oracle: formatPrice(safeMark),
    volume24h: "—",
    funding: Number.isFinite(funding) ? funding * 100 : 0,
    openInterest: info.openInterest,
    markValue: safeMark,
    gradientIndex: index,
  };
};

/** One order-book level. */
export type OrderBookLevel = {
  readonly price: number;
  readonly size: number;
  readonly total: number;
  /** Cumulative-depth bar width, 0..100. */
  readonly depth: number;
};

export type OrderBook = {
  readonly asks: readonly OrderBookLevel[];
  readonly bids: readonly OrderBookLevel[];
  readonly spread: number;
  readonly spreadPct: number;
};

// Deterministic pseudo-random so the ladder is stable across re-renders for a
// given market (seeded by a rolling integer, no Math.random flicker).
const seeded = (seed: number): (() => number) => {
  let s = seed % 2147483647;
  if (s <= 0) {
    s += 2147483646;
  }
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

// Price tick + typical size scale by magnitude so every market reads sanely.
const bookScale = (mark: number): { tick: number; size: number } => {
  if (mark >= 1000) {
    return { tick: mark * 0.00025, size: 3 };
  }
  if (mark >= 1) {
    return { tick: mark * 0.0006, size: 900 };
  }
  return { tick: mark * 0.0012, size: 42000 };
};

/**
 * Synthesizes a stacked order-book ladder (11 asks + 11 bids) around a mark
 * price, with cumulative totals and depth-bar widths. Deterministic per symbol.
 */
export const buildOrderBook = (symbol: string, mark: number): OrderBook => {
  const rand = seeded(
    Array.from(symbol).reduce((acc, ch) => acc + ch.charCodeAt(0), Math.round(mark)),
  );
  const { tick, size } = bookScale(mark);
  const rows = 11;

  const rawAsks: { price: number; sz: number }[] = [];
  let askPrice = mark + tick;
  for (let i = 0; i < rows; i += 1) {
    rawAsks.push({ price: askPrice, sz: (rand() * 0.7 + 0.15) * size });
    askPrice += tick * (rand() * 1.6 + 0.6);
  }
  const rawBids: { price: number; sz: number }[] = [];
  let bidPrice = mark - tick;
  for (let i = 0; i < rows; i += 1) {
    rawBids.push({ price: bidPrice, sz: (rand() * 0.7 + 0.15) * size });
    bidPrice -= tick * (rand() * 1.6 + 0.6);
  }

  const askCumMax = rawAsks.reduce((acc, r) => acc + r.sz, 0);
  const bidCumMax = rawBids.reduce((acc, r) => acc + r.sz, 0);
  const maxCum = Math.max(askCumMax, bidCumMax);

  let cum = 0;
  const asksLowToHigh: OrderBookLevel[] = rawAsks.map((r) => {
    cum += r.sz;
    return { price: r.price, size: r.sz, total: cum, depth: (cum / maxCum) * 100 };
  });
  // Asks render highest price at top, walking down toward the spread.
  const asks = [...asksLowToHigh].reverse();

  cum = 0;
  const bids: OrderBookLevel[] = rawBids.map((r) => {
    cum += r.sz;
    return { price: r.price, size: r.sz, total: cum, depth: (cum / maxCum) * 100 };
  });

  const bestAsk = rawAsks[0]?.price ?? mark;
  const bestBid = rawBids[0]?.price ?? mark;
  const spread = bestAsk - bestBid;
  return { asks, bids, spread, spreadPct: (spread / mark) * 100 };
};
