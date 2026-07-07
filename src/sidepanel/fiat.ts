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

const withThousands = (integerPart: string): string =>
  integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

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
  const [integerPart = "0", decimalPart = "00"] = amount.toFixed(2).split(".");
  return `${symbol}${withThousands(integerPart)}.${decimalPart}`;
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
