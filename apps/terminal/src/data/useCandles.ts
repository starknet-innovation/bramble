/**
 * useCandles — OHLC candles for the detail chart, built from CoinGecko's
 * `market_chart` price series for a token contract. CoinGecko's free contract
 * endpoint returns `prices: [[ms, price], ...]` (not OHLC), so we bucket those
 * points into candles: for each fixed-width time bucket, open = first point,
 * close = last, high/low = extremes. The result feeds the existing
 * `CandlestickChart` `data` prop unchanged (unix-second `time`, o/h/l/c).
 */
import { useCallback } from "react";
import type { Candle } from "../components/CandlestickChart";
import { getJson } from "./cache";
import { coingeckoHeaders, COINGECKO_BASE } from "./endpoints";
import type { Resource } from "./types";
import { useAsyncResource } from "./useAsyncResource";

// Timeframe label -> lookback days requested from CoinGecko.
const DAYS_BY_TIMEFRAME: Readonly<Record<string, number>> = {
  "1d": 1,
  "5d": 5,
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "1y": 365,
  "5y": 1825,
};

// Per-timeframe poll interval: intraday charts refresh often, longer histories
// barely move so they poll slowly (and stay well under CoinGecko's rate limit).
const POLL_MS_BY_TIMEFRAME: Readonly<Record<string, number>> = {
  "1d": 60_000,
  "5d": 120_000,
  "1m": 300_000,
  "3m": 600_000,
  "6m": 900_000,
  "1y": 1_800_000,
  "5y": 3_600_000,
};
const DEFAULT_POLL_MS = 120_000;

const pollForTimeframe = (timeframe: string): number =>
  POLL_MS_BY_TIMEFRAME[timeframe] ?? DEFAULT_POLL_MS;

type MarketChartResponse = {
  readonly prices?: readonly (readonly [number, number])[];
};

/** Buckets a [ms, price] series into ~90 OHLC candles for the timeframe. */
export const bucketCandles = (
  prices: readonly (readonly [number, number])[],
  days: number,
): readonly Candle[] => {
  if (prices.length === 0) {
    return [];
  }
  const targetBuckets = 90;
  const bucketSeconds = Math.max(60, Math.floor((days * 86_400) / targetBuckets));
  const buckets = new Map<number, { open: number; high: number; low: number; close: number }>();
  for (const point of prices) {
    const seconds = Math.floor(point[0] / 1000);
    const price = point[1];
    if (!Number.isFinite(price)) {
      continue;
    }
    const bucket = Math.floor(seconds / bucketSeconds) * bucketSeconds;
    const existing = buckets.get(bucket);
    if (existing === undefined) {
      buckets.set(bucket, { open: price, high: price, low: price, close: price });
    } else {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price;
    }
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([time, ohlc]) => ({ time, ...ohlc }));
};

const fetchCandles = async (
  tokenAddressOrId: string,
  timeframe: string,
  signal: AbortSignal,
): Promise<readonly Candle[]> => {
  const days = DAYS_BY_TIMEFRAME[timeframe] ?? 1;
  const isContract = tokenAddressOrId.startsWith("0x");
  const path = isContract
    ? `/api/v3/coins/starknet/contract/${tokenAddressOrId}/market_chart`
    : `/api/v3/coins/${tokenAddressOrId}/market_chart`;
  const url = `${COINGECKO_BASE}${path}?vs_currency=usd&days=${days}`;
  const payload = await getJson<MarketChartResponse>(url, {
    signal,
    headers: coingeckoHeaders(),
    cacheMs: Math.max(0, pollForTimeframe(timeframe) - 5_000),
  });
  return bucketCandles(payload.prices ?? [], days);
};

/**
 * OHLC candles for `tokenAddressOrId` over `timeframe`. Returns `[]` (not an
 * error) when the source has no series for the token.
 */
export const useCandles = (
  tokenAddressOrId: string | null,
  timeframe: string,
): Resource<readonly Candle[]> => {
  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<readonly Candle[]> => {
      if (tokenAddressOrId === null || tokenAddressOrId.length === 0) {
        return [];
      }
      return fetchCandles(tokenAddressOrId, timeframe, signal);
    },
    [tokenAddressOrId, timeframe],
  );
  return useAsyncResource(fetcher, [tokenAddressOrId ?? "", timeframe], pollForTimeframe(timeframe));
};
