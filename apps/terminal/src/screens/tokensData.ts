/**
 * Screen-local sample data for the Tokens screen. Static mock rows ported from
 * the approved mockup — the left token list, the sample trade tape, and the
 * per-token header/info figures. Real on-chain swap quoting is wired in the
 * screen against the tokens whose mainnet ERC20 `address` is known.
 */
import { MAINNET_TOKEN_ADDRESSES, MAINNET_TOKEN_DECIMALS } from "../protocols";

/** A token row in the left list + its center-pane header/info figures. */
export type SampleToken = {
  readonly name: string;
  readonly symbol: string;
  /** Display price string (mockup-formatted). */
  readonly price: string;
  /** Numeric price for the chart seed. */
  readonly priceNum: number;
  /** 24h change in percent. */
  readonly change: number;
  /** Mainnet ERC20 contract, when known — required to quote real swaps. */
  readonly address?: string;
  /** Token decimals, when known. */
  readonly decimals?: number;
  readonly marketCap: string;
  readonly liquidity: string;
  readonly supply: string;
  readonly top10: string;
  readonly audit: string;
  readonly vol5m: string;
  readonly buys: string;
  readonly sells: string;
  readonly age: string;
  readonly contract: string;
};

const addr = MAINNET_TOKEN_ADDRESSES;
const dec = MAINNET_TOKEN_DECIMALS;

export const SAMPLE_TOKENS: readonly SampleToken[] = [
  {
    name: "Starknet", symbol: "STRK", price: "$0.1428", priceNum: 0.1428, change: 6.3,
    address: addr.STRK, decimals: dec.STRK,
    marketCap: "$684.2M", liquidity: "$42.8M", supply: "4.79B", top10: "31.2%", audit: "Passed",
    vol5m: "$284K", buys: "1,204", sells: "982", age: "2y 4m", contract: "0x04718...c938d",
  },
  {
    name: "Ether", symbol: "ETH", price: "$3,284.10", priceNum: 3284.1, change: 1.8,
    address: addr.ETH, decimals: dec.ETH,
    marketCap: "$312.4B", liquidity: "$1.2B", supply: "120.4M", top10: "18.4%", audit: "Passed",
    vol5m: "$4.1M", buys: "8,204", sells: "7,611", age: "9y", contract: "0x049d3...04dc7",
  },
  {
    name: "USD Coin", symbol: "USDC", price: "$1.00", priceNum: 1.0, change: 0.0,
    address: addr.USDC, decimals: dec.USDC,
    marketCap: "$34.1B", liquidity: "$820M", supply: "34.1B", top10: "44.1%", audit: "Passed",
    vol5m: "$2.6M", buys: "3,110", sells: "3,004", age: "5y", contract: "0x053c9...368a8",
  },
  {
    name: "Ekubo", symbol: "EKUBO", price: "$2.184", priceNum: 2.184, change: -3.4,
    marketCap: "$142.6M", liquidity: "$18.4M", supply: "65.3M", top10: "38.9%", audit: "Passed",
    vol5m: "$412K", buys: "612", sells: "704", age: "1y 2m", contract: "0x075af...1a0c2",
  },
  {
    name: "Nostra", symbol: "NSTR", price: "$0.4210", priceNum: 0.421, change: 11.2,
    marketCap: "$88.2M", liquidity: "$9.6M", supply: "209.5M", top10: "29.7%", audit: "Passed",
    vol5m: "$188K", buys: "421", sells: "312", age: "1y 6m", contract: "0x00c53...4e9d1",
  },
  {
    name: "zkLend", symbol: "ZEND", price: "$0.0842", priceNum: 0.0842, change: -5.8,
    marketCap: "$54.7M", liquidity: "$6.1M", supply: "649.6M", top10: "41.3%", audit: "Passed",
    vol5m: "$96K", buys: "188", sells: "244", age: "1y 8m", contract: "0x0985a...77b30",
  },
  {
    name: "Braavos", symbol: "BRVS", price: "$0.1920", priceNum: 0.192, change: 4.9,
    marketCap: "$41.3M", liquidity: "$4.2M", supply: "215.1M", top10: "36.5%", audit: "Passed",
    vol5m: "$74K", buys: "144", sells: "121", age: "1y", contract: "0x03a0f...b81e4",
  },
  {
    name: "Rhino.fi", symbol: "RHINO", price: "$0.6410", priceNum: 0.641, change: 18.6,
    marketCap: "$29.8M", liquidity: "$3.1M", supply: "46.5M", top10: "48.2%", audit: "Warning",
    vol5m: "$312K", buys: "902", sells: "488", age: "10m", contract: "0x0611c...2ad07",
  },
  {
    name: "Carmine", symbol: "CRM", price: "$0.2140", priceNum: 0.214, change: -2.2,
    marketCap: "$21.4M", liquidity: "$2.4M", supply: "100.0M", top10: "52.1%", audit: "Warning",
    vol5m: "$44K", buys: "88", sells: "104", age: "1y 4m", contract: "0x02b1d...9f6aa",
  },
  {
    name: "Sithswap", symbol: "SITH", price: "$0.0910", priceNum: 0.091, change: 7.7,
    marketCap: "$14.9M", liquidity: "$1.6M", supply: "163.7M", top10: "58.4%", audit: "Warning",
    vol5m: "$28K", buys: "62", sells: "51", age: "1y 1m", contract: "0x07c4e...30b19",
  },
  {
    name: "Unframed", symbol: "UNF", price: "$0.0421", priceNum: 0.0421, change: 31.5,
    marketCap: "$9.6M", liquidity: "$1.1M", supply: "228.0M", top10: "61.9%", audit: "Warning",
    vol5m: "$182K", buys: "512", sells: "204", age: "6m", contract: "0x0a3f2...92e1c",
  },
  {
    name: "Realms", symbol: "LORDS", price: "$0.1820", priceNum: 0.182, change: -9.1,
    marketCap: "$7.2M", liquidity: "$0.9M", supply: "39.6M", top10: "64.2%", audit: "Warning",
    vol5m: "$36K", buys: "71", sells: "98", age: "2y", contract: "0x0124a...ee551",
  },
];

/** A row in the sample trade tape. */
export type SampleTrade = {
  readonly time: string;
  readonly buy: boolean;
  readonly marketCap: string;
  readonly amount: string;
  readonly value: string;
  readonly wallet: string;
};

const WALLETS = [
  "0x04a1..8f2c", "0x07bd..91a4", "0x02fe..3c07", "0x0a91..77e2",
  "0x0533..b8d1", "0x061c..204a", "0x08ff..d3e9", "0x0177..5a6b",
];

/** Deterministic sample trades for the given token symbol/price. */
export const buildSampleTrades = (symbol: string, priceNum: number): readonly SampleTrade[] => {
  const rows: SampleTrade[] = [];
  const baseMc = 684.2;
  for (let i = 0; i < 14; i += 1) {
    const buy = (i * 37 + 11) % 100 > 45;
    const amt = ((i * 3457 + 800) % 40000) + 800;
    const val = Math.round(amt * priceNum);
    rows.push({
      time: `${i * 7 + 3}s ago`,
      buy,
      marketCap: `$${(baseMc + ((i % 5) - 2) * 0.4).toFixed(1)}M`,
      amount: `${amt.toLocaleString()} ${symbol}`,
      value: `$${val.toLocaleString()}`,
      wallet: WALLETS[i % WALLETS.length]!,
    });
  }
  return rows;
};

/** The right-panel quick-amount chips (in the spend token's units). */
export const QUICK_AMOUNTS: readonly string[] = ["0.1", "0.25", "0.5", "1", "5", "10"];

/** Timeframe buttons for the chart bar. */
export const TIMEFRAMES: readonly string[] = ["5y", "1y", "6m", "3m", "1m", "5d", "1d"];
