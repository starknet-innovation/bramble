/**
 * Pure fiat formatting and portfolio math for the side panel. No DOM.
 */
import type { DisplayCurrency } from "@mc-wallet/settings/preferences";

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
 * Formats a cached-price capture time (epoch ms) as a compact, fixed-UTC label
 * for the "last saved" stale indicator, or null when there is no timestamp.
 * UTC is deliberate: it keeps the label deterministic and avoids the implicit
 * clock and date-construction sources the file-standards gate forbids outside
 * the approved boundary modules — the epoch number is formatted directly.
 * Date and time are formatted separately and joined with an explicit ", ":
 * a combined format leaves the joiner to the ICU version (", " vs " at "),
 * so the label would vary across Chrome builds and test environments.
 */
export const formatPriceTimestamp = (asOf: number | null): string | null => {
  if (asOf === null || !Number.isFinite(asOf) || asOf <= 0) {
    return null;
  }
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(asOf);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "UTC",
  }).format(asOf);
  return `${date}, ${time} UTC`;
};

/**
 * Computes the fiat value of a token holding from its formatted decimal
 * balance and unit price. Returns null when no price is available.
 */
export const tokenFiatValue = (
  formattedBalance: string,
  price: number | undefined,
): number | null => {
  if (formattedBalance.trim().length === 0 || price === undefined || !Number.isFinite(price)) {
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

/**
 * A portfolio's 24h movement, split into an always-positive magnitude and its
 * direction, so callers can colour the sign (green up / red down) without
 * re-deriving it. `percent` is the magnitude of the percentage move.
 */
export type PortfolioDelta = {
  readonly absolute: number;
  readonly direction: "down" | "up";
  readonly percent: number;
};

/**
 * Computes the portfolio's 24h fiat and percentage change from current priced
 * balances and each token's 24h percent change. The prior value of every
 * holding is reconstructed from its change, summed, and compared to the current
 * total. Returns null when nothing is priced (no baseline to compare against).
 */
export const portfolioDelta = (
  balances: readonly FiatBalance[],
  prices: Readonly<Record<string, number>>,
  changes: Readonly<Record<string, number>>,
): PortfolioDelta | null => {
  let current = 0;
  let previous = 0;
  let priced = false;
  for (const balance of balances) {
    const value = tokenFiatValue(balance.formatted, prices[balance.address]);
    if (value === null) {
      continue;
    }
    priced = true;
    const change = changes[balance.address];
    // Reconstruct the holding's value 24h ago: value / (1 + change%). A missing
    // or non-finite change leaves that holding flat (it contributes equally to
    // both totals), so it never fabricates movement.
    const prior =
      change === undefined || !Number.isFinite(change) || 1 + change / 100 <= 0
        ? value
        : value / (1 + change / 100);
    current += value;
    previous += prior;
  }
  if (!priced || previous <= 0) {
    return null;
  }
  const absolute = current - previous;
  return {
    absolute: Math.abs(absolute),
    direction: absolute < 0 ? "down" : "up",
    percent: Math.abs((absolute / previous) * 100),
  };
};
