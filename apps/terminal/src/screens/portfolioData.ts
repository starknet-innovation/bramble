/**
 * Screen-local sample data for the Portfolio screen. Static mock holdings,
 * perps positions, and activity rows ported from the approved mockup. These
 * only render post-connect — the disconnected screen is the empty state. No
 * on-chain reads are wired here; the figures are illustrative sample data.
 */

/** A single token holding row. */
export type Holding = {
  readonly symbol: string;
  readonly name: string;
  /** Token quantity held (display string). */
  readonly balance: string;
  /** Unit price in USD. */
  readonly price: number;
  /** Position value in USD (balance * price). */
  readonly value: number;
  /** 24h change in percent. */
  readonly change: number;
  readonly gradientIndex: number;
};

/** A single perps position row. */
export type PerpPosition = {
  readonly market: string;
  readonly side: "Long" | "Short";
  readonly leverage: number;
  /** Notional size in USD. */
  readonly size: number;
  readonly entry: number;
  readonly mark: number;
  /** Margin posted for the position (USD). */
  readonly margin: number;
  /** Unrealized PnL in USD. */
  readonly pnl: number;
  readonly gradientIndex: number;
};

/** A wallet / trade activity event. */
export type Activity = {
  readonly kind: "Buy" | "Sell" | "Open" | "Close";
  readonly symbol: string;
  /** Amount column (qty or contracts, display string). */
  readonly amount: string;
  /** USD value of the event. */
  readonly value: number;
  /** Relative time label. */
  readonly time: string;
  readonly gradientIndex: number;
};

export const HOLDINGS: readonly Holding[] = [
  { symbol: "USDC", name: "USD Coin", balance: "3,200.00", price: 1.0, value: 3200.0, change: 0.0, gradientIndex: 2 },
  { symbol: "ETH", name: "Ether", balance: "0.8500", price: 3284.1, value: 2791.49, change: 1.8, gradientIndex: 1 },
  { symbol: "STRK", name: "Starknet", balance: "12,500", price: 0.1428, value: 1785.0, change: 6.3, gradientIndex: 0 },
  { symbol: "EKUBO", name: "Ekubo", balance: "420.0", price: 2.184, value: 917.28, change: -3.4, gradientIndex: 3 },
  { symbol: "NSTR", name: "Nostra", balance: "1,050", price: 0.421, value: 442.05, change: 11.2, gradientIndex: 4 },
];

export const PERP_POSITIONS: readonly PerpPosition[] = [
  { market: "BTC-PERP", side: "Long", leverage: 10, size: 4200, entry: 62400, mark: 63850, margin: 420, pnl: 142.6, gradientIndex: 5 },
  { market: "ETH-PERP", side: "Short", leverage: 5, size: 2100, entry: 3310, mark: 3284, margin: 420, pnl: 34.2, gradientIndex: 1 },
];

export const TOKEN_ACTIVITY: readonly Activity[] = [
  { kind: "Buy", symbol: "STRK", amount: "12,500", value: 1785.0, time: "2h ago", gradientIndex: 0 },
  { kind: "Buy", symbol: "ETH", amount: "0.85", value: 2791.49, time: "5h ago", gradientIndex: 1 },
  { kind: "Sell", symbol: "ZEND", amount: "3,400", value: 286.28, time: "1d ago", gradientIndex: 5 },
  { kind: "Buy", symbol: "NSTR", amount: "1,050", value: 442.05, time: "2d ago", gradientIndex: 4 },
];

export const PERP_ACTIVITY: readonly Activity[] = [
  { kind: "Open", symbol: "BTC-PERP", amount: "0.0673", value: 4200.0, time: "6h ago", gradientIndex: 5 },
  { kind: "Open", symbol: "ETH-PERP", amount: "0.6344", value: 2100.0, time: "1d ago", gradientIndex: 1 },
  { kind: "Close", symbol: "SOL-PERP", amount: "14.2", value: 2130.0, time: "3d ago", gradientIndex: 3 },
];

/** Aggregate figures for one hero slice (Total / Tokens / Perps). */
export type PortfolioSlice = {
  readonly balance: number;
  readonly pnl: number;
  readonly pnlPct: number;
};

const holdingsPnl = HOLDINGS.reduce((sum, h) => sum + (h.value * h.change) / 100, 0);
const holdingsValue = HOLDINGS.reduce((sum, h) => sum + h.value, 0);
const perpsPnl = PERP_POSITIONS.reduce((sum, p) => sum + p.pnl, 0);
const perpsEquity = PERP_POSITIONS.reduce((sum, p) => sum + p.margin, 0) + perpsPnl;

const slice = (balance: number, pnl: number): PortfolioSlice => ({
  balance,
  pnl,
  pnlPct: balance - pnl === 0 ? 0 : (pnl / (balance - pnl)) * 100,
});

export const PORTFOLIO_TOTALS: Record<"total" | "tokens" | "perps", PortfolioSlice> = {
  total: slice(holdingsValue + perpsEquity, holdingsPnl + perpsPnl),
  tokens: slice(holdingsValue, holdingsPnl),
  perps: slice(perpsEquity, perpsPnl),
};

/** Formats a USD number with thousands separators and 2 decimals. */
export const formatUSD = (value: number): string =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Formats a signed USD PnL with a leading + / -. */
export const formatSignedUSD = (value: number): string =>
  `${value < 0 ? "-" : "+"}${formatUSD(Math.abs(value))}`;
