/**
 * React hooks over Extended's public data. REST-only reads (`usePerpsMarkets`,
 * `usePerpsMarketStats`) build on the shared polling engine (`useAsyncResource`);
 * the live reads (`useOrderBook`, `usePerpsTrades`, `useFunding`,
 * `usePerpsCandles`) open a WS stream for real-time updates and — where a REST
 * route exists — seed from and fall back to REST polling when the socket is
 * unavailable (e.g. jsdom under test, or a blocked WS handshake). Every hook
 * returns the `{data,isLoading,error,refresh}` shape the rest of the data layer
 * uses.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Resource } from "../types";
import { useAsyncResource } from "../useAsyncResource";
import type { CandleInterval, CandleType } from "./config";
import { wsUrls } from "./config";
import { parseCandles, parseFundingRate, parsePublicTrades } from "./parse";
import {
  fetchCandles,
  fetchFundingHistory,
  fetchMarketStats,
  fetchMarkets,
  fetchOrderBook,
} from "./rest";
import type {
  ExtendedCandle,
  ExtendedFunding,
  ExtendedMarket,
  ExtendedMarketStats,
  ExtendedOrderBook,
  ExtendedPublicTrade,
} from "./types";
import { connectStream, createOrderBookAggregator } from "./ws";

const MARKETS_POLL_MS = 30_000;
// Stats are also pushed live over the market-stats surface; a 20s REST poll is a
// calm fallback that stays comfortably within Extended's public rate limits
// (the old 5s poll was needlessly aggressive).
const STATS_POLL_MS = 20_000;
const ORDERBOOK_POLL_MS = 8_000;
const FUNDING_POLL_MS = 60_000;
const CANDLES_POLL_MS = 30_000;
const TRADES_CAP = 50;
const FUNDING_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const CANDLES_SEED_LIMIT = 500;

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Extended request failed";

/**
 * All perp markets (with nested stats + trading/L2 config), polled. The screen
 * discriminates PERPETUAL vs SPOT via `market.type` when present.
 */
export const usePerpsMarkets = (): Resource<readonly ExtendedMarket[]> => {
  const fetcher = useCallback((signal: AbortSignal) => fetchMarkets({ signal }), []);
  return useAsyncResource(fetcher, [], MARKETS_POLL_MS);
};

/**
 * Latest statistics for one market (mark/index/last price, best bid/ask, 24h
 * volume + change, open interest, funding). Polled every few seconds.
 */
export const usePerpsMarketStats = (
  market: string | null,
): Resource<ExtendedMarketStats | null> => {
  const fetcher = useCallback(
    (signal: AbortSignal): Promise<ExtendedMarketStats | null> =>
      market === null || market.length === 0
        ? Promise.resolve(null)
        : fetchMarketStats(market, signal),
    [market],
  );
  return useAsyncResource(fetcher, [market ?? ""], STATS_POLL_MS);
};

/**
 * Live order book: seeded from the REST snapshot, then kept live by the
 * `orderbooks/{market}` WS stream (SNAPSHOT + seq-ordered DELTAs merged by the
 * aggregator). Falls back to REST polling whenever the socket is not open.
 */
export const useOrderBook = (market: string | null): Resource<ExtendedOrderBook | null> => {
  const [book, setBook] = useState<ExtendedOrderBook | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    if (market === null || market.length === 0) {
      setBook(null);
      setIsLoading(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    const aggregator = createOrderBookAggregator(market);
    let wsOpen = false;
    setBook(null);
    setIsLoading(true);

    const loadRest = async (): Promise<void> => {
      try {
        const snapshot = await fetchOrderBook(market, controller.signal);
        if (!active || wsOpen) {
          return;
        }
        aggregator.seed(snapshot);
        setBook(aggregator.snapshot());
        setError(null);
      } catch (cause) {
        if (active && !controller.signal.aborted) {
          setError(toMessage(cause));
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };
    void loadRest();
    const pollId = setInterval(() => {
      if (!wsOpen) {
        void loadRest();
      }
    }, ORDERBOOK_POLL_MS);

    const handle = connectStream({
      url: wsUrls.orderbooks(market),
      onStatus: (status) => {
        wsOpen = status === "open";
      },
      onMessage: (envelope) => {
        if (!active) {
          return;
        }
        aggregator.apply(envelope);
        if (aggregator.hasData()) {
          setBook(aggregator.snapshot());
          setIsLoading(false);
          setError(null);
        }
      },
    });

    return () => {
      active = false;
      controller.abort();
      clearInterval(pollId);
      handle.close();
    };
  }, [market, tick]);

  return { data: book, isLoading, error, refresh };
};

/**
 * Live public trade tape from the `publicTrades/{market}` WS stream. There is no
 * confirmed public recent-trades REST route (catalog GAP), so this cannot be
 * REST-seeded: when the socket is unavailable the tape is empty (the screen
 * shows a clean empty state, never fabricated trades). Newest trade first,
 * capped to `TRADES_CAP`.
 */
export const usePerpsTrades = (market: string | null): Resource<readonly ExtendedPublicTrade[]> => {
  const [trades, setTrades] = useState<readonly ExtendedPublicTrade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    if (market === null || market.length === 0) {
      setTrades([]);
      setIsLoading(false);
      return;
    }
    let active = true;
    setTrades([]);
    setIsLoading(true);

    const handle = connectStream({
      url: wsUrls.publicTrades(market),
      onStatus: (status) => {
        // No REST fallback route exists. Once the socket has connected (or
        // closed), show an empty tape until the next live trade arrives rather
        // than leaving the tab in an indefinite loading state.
        if (active && (status === "open" || status === "closed")) {
          setIsLoading(false);
        }
      },
      onError: (message) => {
        if (active) {
          setError(message);
        }
      },
      onMessage: (envelope) => {
        if (!active) {
          return;
        }
        const incoming = parsePublicTrades(envelope.data);
        if (incoming.length === 0) {
          return;
        }
        setTrades((prev) => {
          const byId = new Map<number, ExtendedPublicTrade>();
          for (const trade of [...prev, ...incoming]) {
            byId.set(trade.id, trade);
          }
          return Array.from(byId.values())
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, TRADES_CAP);
        });
        setIsLoading(false);
        setError(null);
      },
    });

    return () => {
      active = false;
      handle.close();
    };
  }, [market, tick]);

  return { data: trades, isLoading, error, refresh };
};

/**
 * Funding: REST-seeded history over the last week plus the live `funding/{market}`
 * WS stream that prepends new funding points and updates `latest`. `latest`
 * falls back to the newest history point when no WS update has arrived yet.
 */
export const useFunding = (market: string | null): Resource<ExtendedFunding> => {
  const [state, setState] = useState<ExtendedFunding>({ latest: null, history: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  const wsOpenRef = useRef(false);

  useEffect(() => {
    if (market === null || market.length === 0) {
      setState({ latest: null, history: [] });
      setIsLoading(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    wsOpenRef.current = false;
    setState({ latest: null, history: [] });
    setIsLoading(true);

    const loadRest = async (): Promise<void> => {
      try {
        const now = Date.now();
        const history = await fetchFundingHistory(
          market,
          now - FUNDING_LOOKBACK_MS,
          now,
          controller.signal,
        );
        if (!active) {
          return;
        }
        setState((prev) => ({
          history,
          latest: prev.latest ?? history[history.length - 1] ?? null,
        }));
        setError(null);
      } catch (cause) {
        if (active && !controller.signal.aborted) {
          setError(toMessage(cause));
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };
    void loadRest();
    const pollId = setInterval(() => void loadRest(), FUNDING_POLL_MS);

    const handle = connectStream({
      url: wsUrls.funding(market),
      onStatus: (status) => {
        wsOpenRef.current = status === "open";
      },
      onMessage: (envelope) => {
        if (!active) {
          return;
        }
        const rate = parseFundingRate(envelope.data);
        if (rate === null) {
          return;
        }
        setState((prev) => {
          const history = [...prev.history.filter((h) => h.timestamp !== rate.timestamp), rate].sort(
            (a, b) => a.timestamp - b.timestamp,
          );
          return { history, latest: rate };
        });
        setIsLoading(false);
      },
    });

    return () => {
      active = false;
      controller.abort();
      clearInterval(pollId);
      handle.close();
    };
  }, [market, tick]);

  return { data: state, isLoading, error, refresh };
};

/**
 * Candles for a market/series/interval: REST-seeded history then kept current by
 * the `candles/{market}/{candleType}` WS stream. REST and WS both upsert into a
 * time-keyed map, so the series stays correct whether or not the socket is up.
 * `time` is unix seconds so it feeds `CandlestickChart`'s `data` prop directly.
 */
export const usePerpsCandles = (
  market: string | null,
  candleType: CandleType,
  interval: CandleInterval,
): Resource<readonly ExtendedCandle[]> => {
  const [candles, setCandles] = useState<readonly ExtendedCandle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    if (market === null || market.length === 0) {
      setCandles([]);
      setIsLoading(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    const byTime = new Map<number, ExtendedCandle>();
    setCandles([]);
    setIsLoading(true);

    const publish = (): void => {
      setCandles(Array.from(byTime.values()).sort((a, b) => a.time - b.time));
    };
    const upsert = (rows: readonly ExtendedCandle[]): void => {
      for (const candle of rows) {
        byTime.set(candle.time, candle);
      }
    };

    const loadRest = async (): Promise<void> => {
      try {
        const rows = await fetchCandles(market, candleType, interval, {
          limit: CANDLES_SEED_LIMIT,
          signal: controller.signal,
        });
        if (!active) {
          return;
        }
        upsert(rows);
        publish();
        setError(null);
      } catch (cause) {
        if (active && !controller.signal.aborted) {
          setError(toMessage(cause));
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };
    void loadRest();
    const pollId = setInterval(() => void loadRest(), CANDLES_POLL_MS);

    const handle = connectStream({
      url: wsUrls.candles(market, candleType, interval),
      onMessage: (envelope) => {
        if (!active) {
          return;
        }
        // Candle WS frames carry the same {o,h,l,c,v?,T} array shape as REST.
        upsert(parseCandles(envelope.data));
        publish();
        setIsLoading(false);
      },
    });

    return () => {
      active = false;
      controller.abort();
      clearInterval(pollId);
      handle.close();
    };
  }, [market, candleType, interval, tick]);

  return { data: candles, isLoading, error, refresh };
};
