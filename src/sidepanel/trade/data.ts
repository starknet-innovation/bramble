/**
 * Typed shapes and HARDCODED sample data for the trade terminal, modelled on
 * the Phantom-style Discover / Tokens / Perps / Portfolio screens. Every value
 * is a literal — no clocks, no randomness — so the scaffold renders
 * deterministically. A later pass swaps these arrays for live protocol feeds
 * (see src/starknet/protocols) behind the same types; screens should depend on
 * the types, not on the literals.
 *
 * Units: fiat figures are plain numbers in USD; percentages are numbers where
 * positive means up; `sparkline` series are unitless price samples oldest ->
 * newest for the mini charts. Ages are pre-rendered relative strings so no time
 * math (banned in src/) is ever needed.
 */

/**
 * A freshly launched token on the Discover screen.
 */
export type LaunchItem = {
  readonly id: string;
  readonly name: string;
  readonly symbol: string;
  readonly ageLabel: string;
  readonly marketCapUsd: number;
  readonly changePct: number;
  readonly volumeUsd: number;
};

/**
 * A token row on the Tokens screen with its market context.
 */
export type TokenListItem = {
  readonly id: string;
  readonly name: string;
  readonly symbol: string;
  readonly address: string;
  readonly priceUsd: number;
  readonly marketCapUsd: number;
  readonly change24hPct: number;
  readonly sparkline: readonly number[];
};

/**
 * A perpetual market row on the Perps screen.
 */
export type PerpMarketRow = {
  readonly id: string;
  readonly market: string;
  readonly baseSymbol: string;
  readonly priceUsd: number;
  readonly change24hPct: number;
  readonly maxLeverage: number;
  readonly fundingRatePct: number;
  readonly volume24hUsd: number;
};

/**
 * One open holding in the portfolio summary.
 */
export type PortfolioPosition = {
  readonly id: string;
  readonly symbol: string;
  readonly name: string;
  readonly amount: number;
  readonly valueUsd: number;
  readonly change24hPct: number;
};

/**
 * The portfolio summary shown on the Portfolio screen.
 */
export type PortfolioSummary = {
  readonly totalValueUsd: number;
  readonly change24hPct: number;
  readonly availableUsd: number;
  readonly positions: readonly PortfolioPosition[];
};

/**
 * Sample freshly launched tokens for the Discover screen.
 */
export const SAMPLE_LAUNCHES: readonly LaunchItem[] = [
  {
    id: "launch-strkong",
    name: "Strkong",
    symbol: "STRKONG",
    ageLabel: "5m",
    marketCapUsd: 128000,
    changePct: 342.5,
    volumeUsd: 89000,
  },
  {
    id: "launch-cairocat",
    name: "Cairo Cat",
    symbol: "CCAT",
    ageLabel: "22m",
    marketCapUsd: 84000,
    changePct: 118.2,
    volumeUsd: 45200,
  },
  {
    id: "launch-lordsdao",
    name: "Lords DAO",
    symbol: "LDAO",
    ageLabel: "1h",
    marketCapUsd: 512000,
    changePct: 56.7,
    volumeUsd: 210000,
  },
  {
    id: "launch-nostradao",
    name: "Nostra Yield",
    symbol: "NYLD",
    ageLabel: "3h",
    marketCapUsd: 1240000,
    changePct: -12.4,
    volumeUsd: 305000,
  },
  {
    id: "launch-sithswap",
    name: "Sith Swap",
    symbol: "SITH",
    ageLabel: "6h",
    marketCapUsd: 96000,
    changePct: -34.8,
    volumeUsd: 28800,
  },
];

/**
 * Sample market tokens for the Tokens screen.
 */
export const SAMPLE_TOKENS: readonly TokenListItem[] = [
  {
    id: "token-strk",
    name: "Starknet",
    symbol: "STRK",
    address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    priceUsd: 0.142,
    marketCapUsd: 486000000,
    change24hPct: 4.21,
    sparkline: [0.131, 0.129, 0.134, 0.138, 0.136, 0.14, 0.139, 0.142],
  },
  {
    id: "token-eth",
    name: "Ether",
    symbol: "ETH",
    address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    priceUsd: 3120.5,
    marketCapUsd: 375000000000,
    change24hPct: 1.86,
    sparkline: [3040, 3065, 3055, 3088, 3102, 3095, 3110, 3120],
  },
  {
    id: "token-wbtc",
    name: "Wrapped BTC",
    symbol: "WBTC",
    address: "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac",
    priceUsd: 67840.0,
    marketCapUsd: 12000000000,
    change24hPct: -0.92,
    sparkline: [68500, 68320, 68100, 67900, 68050, 67720, 67880, 67840],
  },
  {
    id: "token-usdc",
    name: "USD Coin",
    symbol: "USDC",
    address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
    priceUsd: 1.0,
    marketCapUsd: 32000000000,
    change24hPct: 0.01,
    sparkline: [1.0, 1.0, 1.001, 1.0, 0.999, 1.0, 1.0, 1.0],
  },
  {
    id: "token-usdt",
    name: "Tether USD",
    symbol: "USDT",
    address: "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8",
    priceUsd: 1.0,
    marketCapUsd: 112000000000,
    change24hPct: -0.02,
    sparkline: [1.001, 1.0, 1.0, 0.999, 1.0, 1.0, 0.999, 1.0],
  },
];

/**
 * Sample perpetual markets for the Perps screen.
 */
export const SAMPLE_PERPS: readonly PerpMarketRow[] = [
  {
    id: "perp-btc",
    market: "BTC-USD",
    baseSymbol: "BTC",
    priceUsd: 67912.5,
    change24hPct: 2.14,
    maxLeverage: 50,
    fundingRatePct: 0.012,
    volume24hUsd: 184000000,
  },
  {
    id: "perp-eth",
    market: "ETH-USD",
    baseSymbol: "ETH",
    priceUsd: 3124.8,
    change24hPct: 1.72,
    maxLeverage: 40,
    fundingRatePct: 0.009,
    volume24hUsd: 96000000,
  },
  {
    id: "perp-strk",
    market: "STRK-USD",
    baseSymbol: "STRK",
    priceUsd: 0.1423,
    change24hPct: 5.38,
    maxLeverage: 20,
    fundingRatePct: -0.004,
    volume24hUsd: 12400000,
  },
  {
    id: "perp-sol",
    market: "SOL-USD",
    baseSymbol: "SOL",
    priceUsd: 172.44,
    change24hPct: -1.28,
    maxLeverage: 25,
    fundingRatePct: 0.015,
    volume24hUsd: 54800000,
  },
];

/**
 * Sample portfolio summary for the Portfolio screen.
 */
export const SAMPLE_PORTFOLIO: PortfolioSummary = {
  totalValueUsd: 12480.32,
  change24hPct: 3.42,
  availableUsd: 2140.0,
  positions: [
    {
      id: "pos-eth",
      symbol: "ETH",
      name: "Ether",
      amount: 2.5,
      valueUsd: 7801.25,
      change24hPct: 1.86,
    },
    {
      id: "pos-strk",
      symbol: "STRK",
      name: "Starknet",
      amount: 18000,
      valueUsd: 2556.0,
      change24hPct: 4.21,
    },
    {
      id: "pos-usdc",
      symbol: "USDC",
      name: "USD Coin",
      amount: 2123.07,
      valueUsd: 2123.07,
      change24hPct: 0.01,
    },
  ],
};
