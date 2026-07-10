/**
 * Screen-scoped data for the Discover screen's ranked PERPS column only.
 *
 * The ranked TOKENS column and the Total panel now pull from the real data
 * layer (`useTokens`, `usePortfolio`), and the Launches feed renders a clean
 * empty state. The ranked perps rows below remain the existing static list on
 * purpose: Extended/Perps is owned by a separate, dedicated effort, so this
 * screen's perps column is intentionally left untouched to avoid conflicting
 * with that work. It will be wired to the Extended public REST market data there.
 */

export type RankedPerp = {
  readonly symbol: string;
  readonly leverage: string;
  readonly price: string;
  /** 24h change in percent. */
  readonly change24h: number;
};

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
