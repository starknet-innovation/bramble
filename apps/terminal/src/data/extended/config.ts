/**
 * Path builders and enums for Extended's public API surface. The REST/WS host
 * bases themselves live in `data/endpoints.ts` (the single source of truth for
 * every host the data layer reaches); this module only assembles the per-endpoint
 * paths and centralizes the candle interval/type enums shared by the REST and WS
 * candle endpoints. Nothing here performs I/O.
 */
import { EXTENDED_REST_BASE, EXTENDED_WS_BASE } from "../endpoints";

/**
 * ISO-8601 candle intervals accepted by both the candles REST endpoint and the
 * candles WS stream (identical enum in the catalog).
 */
export const CANDLE_INTERVALS = [
  "PT1M",
  "PT5M",
  "PT15M",
  "PT30M",
  "PT1H",
  "PT2H",
  "PT4H",
  "P1D",
] as const;

/** One of the ISO-8601 candle intervals. */
export type CandleInterval = (typeof CANDLE_INTERVALS)[number];

/**
 * Candle price series available for a market: executed-trade candles, mark-price
 * candles, and index-price candles.
 */
export const CANDLE_TYPES = ["trades", "mark-prices", "index-prices"] as const;

/** One of the candle price-series types. */
export type CandleType = (typeof CANDLE_TYPES)[number];

/**
 * Maps a terminal timeframe label (as the chart timeframe bar spells it) onto the
 * Extended ISO-8601 interval. Falls back to 15m for unknown labels.
 */
export const TIMEFRAME_TO_INTERVAL: Readonly<Record<string, CandleInterval>> = {
  "1m": "PT1M",
  "5m": "PT5M",
  "15m": "PT15M",
  "30m": "PT30M",
  "1h": "PT1H",
  "2h": "PT2H",
  "4h": "PT4H",
  "1d": "P1D",
};

// Strips trailing slashes so a base + path concatenation never double-slashes.
const trimBase = (base: string): string => base.replace(/\/+$/, "");

/** Encodes a market symbol for safe inclusion in a URL path segment. */
const seg = (value: string): string => encodeURIComponent(value);

/**
 * REST path builders (relative to `EXTENDED_REST_BASE`). One per public endpoint
 * in the catalog.
 */
export const restUrls = {
  /** `GET /info/markets` — all markets (+ config + stats), optionally filtered. */
  markets: (markets?: readonly string[]): string => {
    const base = `${trimBase(EXTENDED_REST_BASE)}/info/markets`;
    if (markets === undefined || markets.length === 0) {
      return base;
    }
    const query = markets.map((m) => `market=${seg(m)}`).join("&");
    return `${base}?${query}`;
  },
  /** `GET /info/markets/{market}/stats` — latest stats for one market. */
  marketStats: (market: string): string =>
    `${trimBase(EXTENDED_REST_BASE)}/info/markets/${seg(market)}/stats`,
  /** `GET /info/candles/{market}/{candleType}` — historical candles. */
  candles: (
    market: string,
    candleType: CandleType,
    interval: CandleInterval,
    opts?: { readonly limit?: number; readonly endTime?: number },
  ): string => {
    const params = new URLSearchParams({ interval });
    if (opts?.limit !== undefined) {
      params.set("limit", String(opts.limit));
    }
    if (opts?.endTime !== undefined) {
      params.set("endTime", String(opts.endTime));
    }
    return `${trimBase(EXTENDED_REST_BASE)}/info/candles/${seg(market)}/${seg(candleType)}?${params.toString()}`;
  },
  /** `GET /info/{market}/funding` — funding-rate history (start/end required). */
  funding: (market: string, startTime: number, endTime: number): string => {
    const params = new URLSearchParams({
      startTime: String(startTime),
      endTime: String(endTime),
    });
    return `${trimBase(EXTENDED_REST_BASE)}/info/${seg(market)}/funding?${params.toString()}`;
  },
  /** `GET /info/markets/{market}/orderbook` — L2 order-book snapshot. */
  orderbook: (market: string): string =>
    `${trimBase(EXTENDED_REST_BASE)}/info/markets/${seg(market)}/orderbook`,
} as const;

/**
 * WS stream URL builders (relative to `EXTENDED_WS_BASE`). Extended subscribes by
 * URL path — one socket per stream — so these produce the full connect URL. Where
 * the market segment is optional, omitting it subscribes to all markets.
 */
export const wsUrls = {
  /** `orderbooks/{market?}` — snapshot + deltas. */
  orderbooks: (market?: string): string =>
    market === undefined
      ? `${trimBase(EXTENDED_WS_BASE)}/orderbooks`
      : `${trimBase(EXTENDED_WS_BASE)}/orderbooks/${seg(market)}`,
  /** `publicTrades/{market?}` — live trade tape. */
  publicTrades: (market?: string): string =>
    market === undefined
      ? `${trimBase(EXTENDED_WS_BASE)}/publicTrades`
      : `${trimBase(EXTENDED_WS_BASE)}/publicTrades/${seg(market)}`,
  /** `funding/{market?}` — live funding-rate updates. */
  funding: (market?: string): string =>
    market === undefined
      ? `${trimBase(EXTENDED_WS_BASE)}/funding`
      : `${trimBase(EXTENDED_WS_BASE)}/funding/${seg(market)}`,
  /** `candles/{market}/{candleType}?interval={interval}` — live candle updates. */
  candles: (market: string, candleType: CandleType, interval: CandleInterval): string =>
    `${trimBase(EXTENDED_WS_BASE)}/candles/${seg(market)}/${seg(candleType)}?interval=${seg(interval)}`,
} as const;
