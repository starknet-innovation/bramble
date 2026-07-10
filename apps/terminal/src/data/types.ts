/**
 * Normalized shapes the data hooks produce and the screens consume. These are
 * the app-facing row types the hardcoded sample arrays used to hand-roll; the
 * hooks now populate them from real APIs / on-chain reads.
 */

/** A single price point for a token, keyed elsewhere by address and by symbol. */
export type PriceEntry = {
  /** Spot price in USD, or null when the source had no price. */
  readonly usd: number | null;
  /** 24h price change in percent, or null when unavailable. */
  readonly change24h: number | null;
};

/** The map usePrices exposes: lookup by lowercased contract address or by symbol. */
export type PricesData = {
  readonly byAddress: Readonly<Record<string, PriceEntry>>;
  readonly bySymbol: Readonly<Record<string, PriceEntry>>;
};

/** A normalized market/token row for the Tokens list and Discover rankings. */
export type TokenRow = {
  readonly address: string;
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly logoUri: string | null;
  readonly priceUsd: number | null;
  readonly marketCapUsd: number | null;
  readonly volume24hUsd: number | null;
  readonly liquidityUsd: number | null;
  /** 24h change in percent. */
  readonly change24h: number | null;
};

/** An on-chain ERC20 balance for one known token. */
export type TokenBalance = {
  readonly address: string;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  /** Raw smallest-unit balance. */
  readonly raw: bigint;
  /** Human-formatted balance string. */
  readonly display: string;
  /** Numeric balance for USD arithmetic. */
  readonly amount: number;
};

/** A portfolio holding: an owned balance priced in USD. */
export type Holding = {
  readonly address: string;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly display: string;
  readonly amount: number;
  readonly priceUsd: number | null;
  readonly usdValue: number;
  readonly change24h: number | null;
};

/** Composed portfolio: priced holdings plus aggregate totals. */
export type PortfolioData = {
  readonly holdings: readonly Holding[];
  readonly totalValueUsd: number;
  /** 24h change in portfolio value (USD), derived from per-holding 24h change. */
  readonly pnl24hUsd: number;
  readonly pnl24hPct: number;
};

/** The generic shape every data hook returns. */
export type Resource<T> = {
  readonly data: T | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
};
