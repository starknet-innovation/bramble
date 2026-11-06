/**
 * Captures what a sent amount was worth when the wallet submitted it (mc-wallet
 * issue 480). The price comes from the wallet's own price cache only, read
 * without a network call, and only while it is fresh; a row with no fresh
 * price is recorded without one. Nothing here is ever back-filled, so the
 * Activity row shows what was known at submission or nothing at all.
 */

import type { PriceService } from "@bramble/portfolio/prices";
import type { KeyValueStore } from "@bramble/store/kv";
import {
  type ActivityLog,
  createActivityLog,
  type NewActivityEntry,
  type SubmittedPrice,
} from "@bramble/transactions/activity";
import type { DisplayCurrency } from "@bramble/wallet-model/preferences";

type ValuationDeps = {
  /** Read lazily: the price service may be built after the activity log. */
  readonly prices: () => PriceService;
  readonly readPreferences: () => Promise<{ readonly displayCurrency?: DisplayCurrency }>;
  /** Resolves after `ms`; injected by tests. Defaults to a timer. */
  readonly wait?: (ms: number) => Promise<void>;
};

const DEFAULT_CURRENCY: DisplayCurrency = "usd";

// A price is read from local storage, so it normally answers at once. Past this
// deadline the row is written without one: a price must never hold up, or
// lose, the record of a transaction that is already on its way.
const PRICE_DEADLINE_MS = 1_000;

const timer = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// Only a public send this wallet made has one amount of one token leaving the
// account. Private (STRK20) rows are recorded as `invoke` and are never priced:
// their amounts stay out of anything stored beside a fiat figure.
const priceable = (
  entry: NewActivityEntry,
): entry is NewActivityEntry & { readonly tokenAddress: string } =>
  entry.origin === "wallet" &&
  entry.kind === "transfer" &&
  entry.direction === "out" &&
  entry.submittedPrice === undefined &&
  entry.tokenAddress !== undefined &&
  entry.amount !== undefined &&
  Number.isFinite(Number(entry.amount)) &&
  Number(entry.amount) > 0;

const capturePrice = async (
  entry: NewActivityEntry & { readonly tokenAddress: string },
  deps: ValuationDeps,
): Promise<SubmittedPrice | null> => {
  const currency = (await deps.readPreferences()).displayCurrency ?? DEFAULT_CURRENCY;
  const answer = await deps.prices().getPrices({
    addresses: [entry.tokenAddress],
    cached: true,
    currency,
    networkId: entry.networkId,
  });
  const unitPrice = answer.prices[entry.tokenAddress];
  // A stale or undated answer is the last price the wallet saw, not the price
  // at submission, so it is not recorded.
  if (answer.stale || answer.asOf === null || unitPrice === undefined) return null;
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;
  return { currency: answer.currency, pricedAt: answer.asOf, unitPrice };
};

/** Adds the submission price to a row when one is known; never fails. */
const withPrice = async (
  entry: NewActivityEntry,
  deps: ValuationDeps,
): Promise<NewActivityEntry> => {
  if (!priceable(entry)) return entry;
  const deadline = (deps.wait ?? timer)(PRICE_DEADLINE_MS).then(() => null);
  try {
    const submittedPrice = await Promise.race([capturePrice(entry, deps), deadline]);
    return submittedPrice === null ? entry : { ...entry, submittedPrice };
  } catch {
    // A price is a nicety; the row itself must still be written.
    return entry;
  }
};

/**
 * Wraps an Activity log so every row written for a public send carries the
 * unit price known at that moment. Every other method passes through.
 */
export const withSubmittedPrice = (log: ActivityLog, deps: ValuationDeps): ActivityLog => ({
  ...log,
  record: async (entry) => log.record(await withPrice(entry, deps)),
  recordIfAbsent: async (entry) => log.recordIfAbsent(await withPrice(entry, deps)),
});

/**
 * The background's Activity log, pricing public sends as they are recorded.
 * Undefined when the log cannot be created, as the background tolerates.
 */
export const createPricedActivityLog = (
  store: KeyValueStore,
  deps: ValuationDeps,
): ActivityLog | undefined => {
  try {
    return withSubmittedPrice(createActivityLog({ store }), deps);
  } catch {
    return undefined;
  }
};
