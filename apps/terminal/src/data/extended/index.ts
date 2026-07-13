/**
 * Barrel for the Extended (x10) public market-data layer: the REST client, the
 * WS client + order-book aggregator, the React hooks, the pure parsers, and the
 * typed models. Screens import the hooks/formatters from here.
 */
export {
  CANDLE_INTERVALS,
  CANDLE_TYPES,
  TIMEFRAME_TO_INTERVAL,
  restUrls,
  wsUrls,
} from "./config";
export type { CandleInterval, CandleType } from "./config";
export {
  ExtendedApiError,
  parseCandles,
  parseFundingHistory,
  parseFundingRate,
  parseMarketStats,
  parseMarketStatsResponse,
  parseMarkets,
  parseOrderBook,
  parseOrderBookResponse,
  parsePublicTrade,
  parsePublicTrades,
  parseStreamMessage,
} from "./parse";
export {
  fetchCandles,
  fetchFundingHistory,
  fetchMarketStats,
  fetchMarkets,
  fetchOrderBook,
} from "./rest";
export {
  connectStream,
  createOrderBookAggregator,
  type ConnectStreamOptions,
  type OrderBookAggregator,
  type StreamHandle,
  type StreamStatus,
} from "./ws";
export {
  useFunding,
  useOrderBook,
  usePerpsCandles,
  usePerpsMarketStats,
  usePerpsMarkets,
  usePerpsTrades,
} from "./hooks";
export type {
  CandleSeries,
  ExtendedCandle,
  ExtendedFunding,
  ExtendedFundingRate,
  ExtendedL2Config,
  ExtendedMarket,
  ExtendedMarketStats,
  ExtendedOrderBook,
  ExtendedOrderBookLevel,
  ExtendedPublicTrade,
  ExtendedTradeSide,
  ExtendedTradingConfig,
  StreamEnvelope,
} from "./types";
