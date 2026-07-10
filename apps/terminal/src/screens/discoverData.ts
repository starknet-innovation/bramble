/**
 * Screen-scoped hardcoded sample data for the Discover screen. Starknet-flavored
 * meme launches, ranked tokens (STRK/ETH/USDC/…), and ranked perps (BTC/ETH/STRK
 * with leverage). Purely presentational — no network calls.
 */

export type LaunchRow = {
  readonly name: string;
  readonly ticker: string;
  readonly age: string;
  readonly txCount: string;
  /** Small stat pills, e.g. "H 68%", "DEV 2%", "SNIP 1%". */
  readonly pills: readonly string[];
  readonly marketCap: string;
  readonly volume: string;
};

export type RankedToken = {
  readonly name: string;
  readonly symbol: string;
  readonly marketCap: string;
  /** 24h change in percent. */
  readonly change24h: number;
};

export type RankedPerp = {
  readonly symbol: string;
  readonly leverage: string;
  readonly price: string;
  /** 24h change in percent. */
  readonly change24h: number;
};

export const LAUNCHES: readonly LaunchRow[] = [
  { name: "STARKAT", ticker: "SKAT", age: "2m", txCount: "412", pills: ["H 68%", "DEV 2%", "SNIP 1%"], marketCap: "$284K", volume: "$1.2M" },
  { name: "CairoPepe", ticker: "CPEPE", age: "5m", txCount: "1.2K", pills: ["H 54%", "DEV 0%", "SNIP 3%"], marketCap: "$1.8M", volume: "$4.6M" },
  { name: "StrkDoge", ticker: "SDOGE", age: "11m", txCount: "842", pills: ["H 61%", "DEV 4%", "SNIP 2%"], marketCap: "$920K", volume: "$2.1M" },
  { name: "ProvableFrog", ticker: "PFROG", age: "18m", txCount: "356", pills: ["H 72%", "DEV 1%", "SNIP 0%"], marketCap: "$412K", volume: "$780K" },
  { name: "ZkBonk", ticker: "ZBONK", age: "24m", txCount: "2.4K", pills: ["H 48%", "DEV 6%", "SNIP 5%"], marketCap: "$3.1M", volume: "$8.9M" },
  { name: "SharpChad", ticker: "CHAD", age: "37m", txCount: "198", pills: ["H 80%", "DEV 0%", "SNIP 1%"], marketCap: "$188K", volume: "$310K" },
  { name: "NostraNyan", ticker: "NYAN", age: "52m", txCount: "1.6K", pills: ["H 57%", "DEV 3%", "SNIP 2%"], marketCap: "$1.4M", volume: "$3.3M" },
  { name: "MadaraMoon", ticker: "MOON", age: "1h", txCount: "623", pills: ["H 63%", "DEV 2%", "SNIP 1%"], marketCap: "$640K", volume: "$1.5M" },
  { name: "FeltFinance", ticker: "FELT", age: "1h", txCount: "289", pills: ["H 66%", "DEV 5%", "SNIP 0%"], marketCap: "$302K", volume: "$690K" },
];

export const RANKED_TOKENS: readonly RankedToken[] = [
  { name: "Ether", symbol: "ETH", marketCap: "$312.4B", change24h: 2.1 },
  { name: "Starknet", symbol: "STRK", marketCap: "$684.2M", change24h: 6.3 },
  { name: "USD Coin", symbol: "USDC", marketCap: "$34.1B", change24h: 0.0 },
  { name: "Ekubo", symbol: "EKUBO", marketCap: "$142.6M", change24h: -3.4 },
  { name: "Nostra", symbol: "NSTR", marketCap: "$88.2M", change24h: 11.2 },
  { name: "zkLend", symbol: "ZEND", marketCap: "$54.7M", change24h: -5.8 },
  { name: "Braavos", symbol: "BRVS", marketCap: "$41.3M", change24h: 4.9 },
  { name: "Rhino", symbol: "RHINO", marketCap: "$29.8M", change24h: 18.6 },
  { name: "Carmine", symbol: "CRM", marketCap: "$21.4M", change24h: -2.2 },
  { name: "Sithswap", symbol: "SITH", marketCap: "$14.9M", change24h: 7.7 },
  { name: "Unframed", symbol: "UNF", marketCap: "$9.6M", change24h: 31.5 },
  { name: "Realms", symbol: "LORDS", marketCap: "$7.2M", change24h: -9.1 },
];

export const RANKED_PERPS: readonly RankedPerp[] = [
  { symbol: "BTC", leverage: "40x", price: "$63,842", change24h: 2.1 },
  { symbol: "ETH", leverage: "40x", price: "$3,284", change24h: 1.8 },
  { symbol: "SOL", leverage: "20x", price: "$168.4", change24h: -4.2 },
  { symbol: "STRK", leverage: "10x", price: "$0.1428", change24h: 6.3 },
  { symbol: "SUI", leverage: "20x", price: "$1.842", change24h: 9.1 },
  { symbol: "DOGE", leverage: "20x", price: "$0.1621", change24h: -1.4 },
  { symbol: "AVAX", leverage: "15x", price: "$36.28", change24h: 3.3 },
  { symbol: "LINK", leverage: "20x", price: "$18.92", change24h: -2.7 },
  { symbol: "ARB", leverage: "20x", price: "$0.8241", change24h: 5.5 },
  { symbol: "TIA", leverage: "15x", price: "$8.914", change24h: -6.8 },
];
