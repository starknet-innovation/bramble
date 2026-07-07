/**
 * Pure fiat formatting and portfolio math for the side panel. No DOM.
 */
import type { DisplayCurrency } from "../storage/preferences-store";

/**
 * Currency glyphs for the three supported display currencies.
 */
export const CURRENCY_SYMBOLS: Readonly<Record<DisplayCurrency, string>> = {
  eur: "€",
  gbp: "£",
  usd: "$",
};

// Locale grouping with fixed 2 decimals. Unlike `toFixed`, this never switches
// to exponential notation for very large magnitudes (>=1e21), so huge balances
// still render as plain grouped digits rather than a garbled "$1e+21.00".
const groupWithThousands = (amount: number): string =>
  amount.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    useGrouping: true,
  });

/**
 * Formats a fiat amount with its currency glyph, thousands separators, and two
 * decimals. Tiny positive amounts collapse to a `<0.01` marker so they never
 * render as a misleading `0.00`.
 */
export const formatFiat = (amount: number, currency: DisplayCurrency): string => {
  const symbol = CURRENCY_SYMBOLS[currency];
  if (!Number.isFinite(amount) || amount <= 0) {
    return `${symbol}0.00`;
  }
  if (amount < 0.01) {
    return `${symbol}<0.01`;
  }
  return `${symbol}${groupWithThousands(amount)}`;
};

/**
 * Computes the fiat value of a token holding from its formatted decimal
 * balance and unit price. Returns null when no price is available.
 */
export const tokenFiatValue = (
  formattedBalance: string,
  price: number | undefined,
): number | null => {
  if (price === undefined || !Number.isFinite(price)) {
    return null;
  }
  const amount = Number(formattedBalance);
  return Number.isFinite(amount) ? amount * price : null;
};

/**
 * Balance row shape needed to total a portfolio.
 */
export type FiatBalance = {
  readonly address: string;
  readonly formatted: string;
};

/**
 * Sums the fiat value of every priced balance; unpriced balances contribute
 * nothing.
 */
export const portfolioTotal = (
  balances: readonly FiatBalance[],
  prices: Readonly<Record<string, number>>,
): number =>
  balances.reduce((total, balance) => {
    const value = tokenFiatValue(balance.formatted, prices[balance.address]);
    return value === null ? total : total + value;
  }, 0);
