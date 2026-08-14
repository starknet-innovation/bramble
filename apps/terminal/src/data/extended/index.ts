/**
 * Barrel for the Extended (x10) public market-data layer: the REST client, the
 * WS client + order-book aggregator, the React hooks, the pure parsers, and the
 * typed models. Screens import the hooks/formatters from here.
 */
export { TIMEFRAME_TO_INTERVAL } from "./config";
export type { CandleInterval } from "./config";
export { fetchCandles } from "./rest";
export {
  useFunding,
  useOrderBook,
  usePerpsCandles,
  usePerpsMarketStats,
  usePerpsMarkets,
  usePerpsTrades,
} from "./hooks";
export type {
  ExtendedMarket,
  ExtendedMarketStats,
  ExtendedOrderBook,
  ExtendedPublicTrade,
} from "./types";
