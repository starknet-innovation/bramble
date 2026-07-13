/**
 * Real OHLC candles from AVNU's supported market-data endpoint. Keeping token
 * metadata, current prices, and history on one source avoids CoinGecko's
 * anonymous rate limits and missing Starknet-contract coverage.
 */
import { useCallback } from "react";
import type { Candle } from "../components/CandlestickChart";
import { getJson } from "./cache";
import { AVNU_MARKETS_BASE } from "./endpoints";
import type { Resource } from "./types";
import { useAsyncResource } from "./useAsyncResource";

const TIMEFRAMES: Readonly<Record<string, { readonly days: number; readonly resolution: string }>> = {
  "1d": { days: 1, resolution: "15" },
  "5d": { days: 5, resolution: "1H" },
  "1m": { days: 30, resolution: "4H" },
  "3m": { days: 90, resolution: "1D" },
  "6m": { days: 180, resolution: "1D" },
  "1y": { days: 365, resolution: "1W" },
  "5y": { days: 1825, resolution: "1W" },
};

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

type AvnuCandle = {
  readonly date?: string;
  readonly open?: number;
  readonly high?: number;
  readonly low?: number;
  readonly close?: number;
};

/** Normalizes AVNU's dated OHLC rows into ascending lightweight-charts candles. */
export const toAvnuCandles = (payload: readonly AvnuCandle[]): readonly Candle[] =>
  payload
    .flatMap((row): readonly Candle[] => {
      const time = row.date === undefined ? Number.NaN : Date.parse(row.date) / 1000;
      const values = [row.open, row.high, row.low, row.close];
      if (!Number.isFinite(time) || values.some((value) => !Number.isFinite(value))) {
        return [];
      }
      return [
        {
          time: Math.floor(time),
          open: row.open!,
          high: row.high!,
          low: row.low!,
          close: row.close!,
        },
      ];
    })
    .sort((a, b) => a.time - b.time);

const fetchCandles = async (
  tokenAddress: string,
  timeframe: string,
  signal: AbortSignal,
): Promise<readonly Candle[]> => {
  const config = TIMEFRAMES[timeframe] ?? TIMEFRAMES["1d"]!;
  const end = new Date();
  const start = new Date(end.getTime() - config.days * 86_400_000);
  const params = new URLSearchParams({
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    resolution: config.resolution,
  });
  const url = `${AVNU_MARKETS_BASE}/v3/tokens/${encodeURIComponent(tokenAddress)}/prices/candle?${params}`;
  const payload = await getJson<readonly AvnuCandle[]>(url, {
    signal,
    cacheMs: Math.max(0, pollForTimeframe(timeframe) - 5_000),
    retries: 0,
  });
  return toAvnuCandles(payload);
};

/** OHLC candles for a token contract. Returns `[]` when no series is available. */
export const useCandles = (
  tokenAddress: string | null,
  timeframe: string,
): Resource<readonly Candle[]> => {
  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<readonly Candle[]> => {
      if (tokenAddress === null || tokenAddress.length === 0) {
        return [];
      }
      return fetchCandles(tokenAddress, timeframe, signal);
    },
    [tokenAddress, timeframe],
  );
  return useAsyncResource(fetcher, [tokenAddress ?? "", timeframe], pollForTimeframe(timeframe));
};
