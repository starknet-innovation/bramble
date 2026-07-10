/**
 * Typed REST client for Extended's public market-data surface — one function per
 * public endpoint in the catalog, built on the shared `getJson` (HttpError +
 * AbortSignal + in-flight de-dup, TTL cache, and 429/5xx backoff). Every function
 * threads the caller's `AbortSignal` so the polling hooks cancel in-flight
 * requests, and returns the decoded models from `parse.ts` (never the raw
 * envelope or short keys).
 *
 * Covered endpoints:
 *   1. GET /info/markets                         -> fetchMarkets
 *   2. GET /info/markets/{market}/stats          -> fetchMarketStats
 *   3. GET /info/candles/{market}/{candleType}   -> fetchCandles
 *   4. GET /info/{market}/funding                -> fetchFundingHistory
 *   5. GET /info/markets/{market}/orderbook      -> fetchOrderBook
 *
 * There is no confirmed public recent-trades REST route (the catalog flags
 * `/info/markets/{market}/trades` as UNCONFIRMED); public trades are sourced from
 * the WS `publicTrades` stream instead — see `ws.ts` / `usePerpsTrades`.
 */
import { getJson } from "../cache";
import type { CandleInterval, CandleType } from "./config";
import { restUrls } from "./config";
import {
  parseCandles,
  parseFundingHistory,
  parseMarkets,
  parseMarketStatsResponse,
  parseOrderBookResponse,
} from "./parse";
import type {
  ExtendedCandle,
  ExtendedFundingRate,
  ExtendedMarket,
  ExtendedMarketStats,
  ExtendedOrderBook,
} from "./types";

/** `GET /info/markets` — all markets (+ nested config + stats), optionally filtered. */
export const fetchMarkets = async (
  opts?: { readonly markets?: readonly string[]; readonly signal?: AbortSignal },
): Promise<readonly ExtendedMarket[]> => {
  const url = restUrls.markets(opts?.markets);
  const payload = await getJson<unknown>(url, { signal: opts?.signal, cacheMs: 25_000 });
  return parseMarkets(payload);
};

/**
 * `GET /info/markets/{market}/stats` — latest stats for one market. This carries
 * mark/index/last price, best bid/ask, 24h volume + change, open interest, and
 * the current + next funding rate.
 */
export const fetchMarketStats = async (
  market: string,
  signal?: AbortSignal,
): Promise<ExtendedMarketStats | null> => {
  const payload = await getJson<unknown>(restUrls.marketStats(market), { signal, cacheMs: 12_000 });
  return parseMarketStatsResponse(payload);
};

/**
 * `GET /info/candles/{market}/{candleType}` — historical candles (o/h/l/c/v/T),
 * returned ascending by time. `candleType` selects the trade/mark/index series.
 */
export const fetchCandles = async (
  market: string,
  candleType: CandleType,
  interval: CandleInterval,
  opts?: { readonly limit?: number; readonly endTime?: number; readonly signal?: AbortSignal },
): Promise<readonly ExtendedCandle[]> => {
  const url = restUrls.candles(market, candleType, interval, {
    limit: opts?.limit,
    endTime: opts?.endTime,
  });
  const payload = await getJson<unknown>(url, { signal: opts?.signal, cacheMs: 20_000 });
  return parseCandles(payload);
};

/**
 * `GET /info/{market}/funding` — funding-rate history over [startTime, endTime]
 * (both epoch-ms, both required by the API), returned ascending by time.
 */
export const fetchFundingHistory = async (
  market: string,
  startTime: number,
  endTime: number,
  signal?: AbortSignal,
): Promise<readonly ExtendedFundingRate[]> => {
  const url = restUrls.funding(market, startTime, endTime);
  const payload = await getJson<unknown>(url, { signal, cacheMs: 55_000 });
  return parseFundingHistory(payload);
};

/** `GET /info/markets/{market}/orderbook` — current L2 order-book snapshot. */
export const fetchOrderBook = async (
  market: string,
  signal?: AbortSignal,
): Promise<ExtendedOrderBook> => {
  const payload = await getJson<unknown>(restUrls.orderbook(market), { signal, cacheMs: 5_000 });
  return parseOrderBookResponse(payload);
};
