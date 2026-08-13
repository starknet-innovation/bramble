/**
 * UI-config constants for the Tokens screen. The token list, market stats, chart
 * data, and trade tape are no longer hardcoded here — they come from the real
 * data layer (`useTokens`, `usePrices`, `useCandles`). Only the presentational
 * config below (chart timeframe buttons + trade-panel quick-amount chips) is
 * kept, as these are fixed UI options, not data.
 */

/** Timeframe buttons for the chart bar. Must be keys `useCandles` understands. */
export const TIMEFRAMES: readonly string[] = ["1y", "6m", "3m", "1m", "5d", "1d"];
