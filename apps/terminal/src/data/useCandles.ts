/**
 * Real token price history from AVNU's supported market-data endpoint. AVNU's
 * OHLC endpoint currently fails for most non-ETH contracts, while its line
 * endpoint powers the same global USD history embedded in the token market
 * response. Consecutive observations become interval candles without inventing
 * highs or lows.
 */
import { useCallback } from "react";
import type { Candle } from "../components/CandlestickChart";
import { getJson } from "./cache";
import { AVNU_MARKETS_BASE } from "./endpoints";
import { fetchCandles as fetchExtendedCandles, type CandleInterval } from "./extended";
import type { Resource } from "./types";
import { useAsyncResource } from "./useAsyncResource";

const TIMEFRAMES: Readonly<
  Record<
    string,
    { readonly days: number; readonly resolution: string; readonly extended: CandleInterval }
  >
> = {
  "1d": { days: 1, resolution: "15", extended: "PT15M" },
  "5d": { days: 5, resolution: "1H", extended: "PT1H" },
  "1m": { days: 30, resolution: "4H", extended: "PT4H" },
  "3m": { days: 90, resolution: "1D", extended: "P1D" },
  "6m": { days: 180, resolution: "1D", extended: "P1D" },
  "1y": { days: 365, resolution: "1W", extended: "P1D" },
};

const POLL_MS_BY_TIMEFRAME: Readonly<Record<string, number>> = {
  "1d": 60_000,
  "5d": 120_000,
  "1m": 300_000,
  "3m": 600_000,
  "6m": 900_000,
  "1y": 1_800_000,
};
const DEFAULT_POLL_MS = 120_000;

const pollForTimeframe = (timeframe: string): number =>
  POLL_MS_BY_TIMEFRAME[timeframe] ?? DEFAULT_POLL_MS;

type AvnuPricePoint = {
  readonly date?: string;
  readonly value?: number;
};

/** Converts AVNU's dated USD observations into ascending interval candles. */
export const toAvnuCandles = (payload: readonly AvnuPricePoint[]): readonly Candle[] => {
  const points = payload
    .flatMap((row) => {
      const time = row.date === undefined ? Number.NaN : Date.parse(row.date) / 1000;
      return Number.isFinite(time) && Number.isFinite(row.value) && Number(row.value) > 0
        ? [{ time: Math.floor(time), value: Number(row.value) }]
        : [];
    })
    .sort((left, right) => left.time - right.time);
  return points.map((point, index) => {
    const open = points[index - 1]?.value ?? point.value;
    return {
      time: point.time,
      open,
      high: Math.max(open, point.value),
      low: Math.min(open, point.value),
      close: point.value,
    };
  });
};

const extendedMarket = (symbol: string | null): string | null => {
  if (symbol === null) return null;
  const normalized = symbol.toUpperCase();
  if (/^(?:USDC(?:\.E)?|USDT|DAI|DAIV0|AUSD\d*|USDU|LUSD|USN|CASH)$/.test(normalized)) {
    return null;
  }
  const asset = normalized === "WBTC" ? "BTC" : normalized === "WETH" ? "ETH" : normalized;
  return /^[A-Z0-9]{2,16}$/.test(asset) ? `${asset}-USD` : null;
};

const fetchAvnuCandles = async (
  tokenAddress: string,
  timeframe: string,
  signal: AbortSignal,
): Promise<readonly Candle[]> => {
  const requested = TIMEFRAMES[timeframe] ?? TIMEFRAMES["1d"]!;
  const end = new Date();
  const durations = [...new Set(
    Object.values(TIMEFRAMES)
      .filter((config) => config.days <= requested.days)
      .sort((left, right) => right.days - left.days)
      .map((config) => config.days),
  )];
  let firstError: unknown = null;
  let reachedHistory = false;
  for (const days of durations) {
    const resolution =
      Object.values(TIMEFRAMES).find((config) => config.days === days)?.resolution ??
      requested.resolution;
    const params = new URLSearchParams({
      startDate: new Date(end.getTime() - days * 86_400_000).toISOString(),
      endDate: end.toISOString(),
      resolution,
    });
    const url = `${AVNU_MARKETS_BASE}/v3/tokens/${encodeURIComponent(tokenAddress)}/prices/line?${params}`;
    try {
      const payload = await getJson<readonly AvnuPricePoint[]>(url, {
        signal,
        cacheMs: Math.max(0, pollForTimeframe(timeframe) - 5_000),
        retries: 0,
      });
      reachedHistory = true;
      const candles = toAvnuCandles(payload);
      if (candles.length > 0) {
        return candles;
      }
    } catch (cause) {
      if (signal.aborted) throw cause;
      firstError ??= cause;
    }
  }
  if (!reachedHistory && firstError !== null) {
    throw firstError;
  }
  return [];
};

/** Price-history candles for a token contract. Returns `[]` when no series is available. */
export const useCandles = (
  tokenAddress: string | null,
  timeframe: string,
  symbol: string | null = null,
): Resource<readonly Candle[]> => {
  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<readonly Candle[]> => {
      if (tokenAddress === null || tokenAddress.length === 0) {
        return [];
      }
      const config = TIMEFRAMES[timeframe] ?? TIMEFRAMES["1d"]!;
      const market = extendedMarket(symbol);
      if (market !== null) {
        try {
          const candles = await fetchExtendedCandles(market, "index-prices", config.extended, {
            limit: 500,
            signal,
          });
          if (candles.length > 0) {
            return candles.map(({ time, open, high, low, close }) => ({
              time,
              open,
              high,
              low,
              close,
            }));
          }
        } catch (cause) {
          if (signal.aborted) throw cause;
          // Tokens without a matching Extended market fall through to AVNU.
        }
      }
      return fetchAvnuCandles(tokenAddress, timeframe, signal);
    },
    [symbol, tokenAddress, timeframe],
  );
  return useAsyncResource(
    fetcher,
    [tokenAddress ?? "", symbol ?? "", timeframe],
    pollForTimeframe(timeframe),
  );
};
