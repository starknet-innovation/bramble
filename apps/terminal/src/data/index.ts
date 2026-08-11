/**
 * Barrel for the terminal's real data layer. Screens import hooks + formatters
 * from "./index". Every hook returns live API / on-chain data (no sample rows).
 */
export { fetchJson, HttpError, withRpc } from "./core/client";
export {
  AVNU_BASE,
  AVNU_MARKETS_BASE,
  EKUBO_BASE,
  EXTENDED_REST_BASE,
  EXTENDED_WS_BASE,
  RPC_URLS,
  STARKSCAN_BASE,
} from "./core/endpoints";
export {
  CANDLE_INTERVALS,
  CANDLE_TYPES,
  TIMEFRAME_TO_INTERVAL,
  connectStream,
  createOrderBookAggregator,
  fetchCandles,
  fetchFundingHistory,
  fetchMarketStats,
  fetchMarkets,
  fetchOrderBook,
  useFunding,
  useOrderBook,
  usePerpsCandles,
  usePerpsMarketStats,
  usePerpsMarkets,
  usePerpsTrades,
} from "./extended/index";
export type {
  CandleInterval,
  CandleType,
  ExtendedCandle,
  ExtendedFunding,
  ExtendedFundingRate,
  ExtendedMarket,
  ExtendedMarketStats,
  ExtendedOrderBook,
  ExtendedOrderBookLevel,
  ExtendedPublicTrade,
} from "./extended/index";
export {
  formatCompactUsd,
  formatPct,
  formatPrice,
  formatSignedUsd,
  formatTokenAmount,
  formatUsd,
} from "./core/format";
export {
  readFollowedAssets,
  toggleFollowedAsset,
  useFollowedAssets,
} from "./social/follows";
export type { FollowedAsset } from "./social/follows";
export { KNOWN_TOKENS, type KnownToken } from "./market/knownTokens";
export { useAsyncResource } from "./core/useAsyncResource";
export { useBalances } from "./market/useBalances";
export { toAvnuCandles, useCandles } from "./market/useCandles";
export { usePortfolio, type UsePortfolioResult } from "./market/usePortfolio";
export { usePrices } from "./market/usePrices";
export {
  fetchTokenTrades,
  parseEkuboTokenTrades,
  useTokenTrades,
} from "./market/useTokenTrades";
export {
  fetchWalletActivity,
  parseWalletActivity,
  useChainPulse,
  useWalletActivity,
} from "./activity/starkscan";
export type {
  ChainBlock,
  ChainEvent,
  ChainMessage,
  ChainPulse,
  ChainTransaction,
  WalletActivity,
} from "./activity/starkscan";
export { useTokens } from "./market/useTokens";
export {
  fetchVesuMarkets,
  fetchVesuPositions,
  fetchVesuRedeems,
  fetchVesuRewards,
  fetchVesuVaults,
  parseVesuMarkets,
  parseVesuPositions,
  parseVesuRedeems,
  parseVesuRewards,
  parseVesuVaults,
  useVesuMarkets,
  useVesuPositions,
  useVesuRedeems,
  useVesuRewards,
  useVesuVaults,
  vesuFixed,
} from "./vesu/index";
export type {
  VesuMarket,
  VesuMarketsData,
  VesuPair,
  VesuPosition,
  VesuRewards,
  VesuRedeem,
  VesuVault,
} from "./vesu/index";
export type {
  Holding,
  PortfolioData,
  PriceEntry,
  PricesData,
  Resource,
  TokenBalance,
  TokenRow,
  TokenTrade,
} from "./core/types";
