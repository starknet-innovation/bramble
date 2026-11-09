/**
 * Stored fiat price cache: its validated shape, and the per-address freshness
 * rules the price service uses to decide what it may serve as current.
 *
 * Freshness is tracked per address, never for the snapshot as a whole. Each
 * address is fetched on its own, so one token's refresh says nothing about
 * another's age; a single cache-wide timestamp would let a months-old price
 * ride along with a fresh one and be reported as current (mc-wallet #357).
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type { DisplayCurrency } from "@bramble/wallet-model/preferences";
import { isFinitePriceNumber, type PriceEntry, type PriceOutcome } from "./prices-feed";

/** How long a successfully fetched address price counts as current. */
const PRICE_TTL_MS = 5 * 60 * 1000;

/** How long a failed attempt suppresses refetching the same address. */
export const PRICE_RETRY_BACKOFF_MS = 60_000;

/**
 * The persisted price cache. `refreshed` holds, per normalized address, the
 * epoch (ms) the feed last answered for it; an address absent from it has no
 * vouched age and is never treated as fresh. `fetchedAt` is the last write and
 * is kept only for storage compatibility, not for freshness.
 */
export type PriceCache = {
  readonly attempted?: Readonly<Record<string, number>>;
  readonly changes?: Readonly<Record<string, number>>;
  readonly checked?: readonly string[];
  readonly fetchedAt: number;
  readonly prices: Readonly<Record<string, PriceEntry>>;
  readonly refreshed?: Readonly<Record<string, number>>;
};

const CURRENCIES: readonly DisplayCurrency[] = ["eur", "gbp", "usd"];

const isPriceEntry = (value: unknown): value is PriceEntry =>
  isRecord(value) && CURRENCIES.every((currency) => isFinitePriceNumber(value[currency]));

const isCheckedList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isTimestampMap = (value: unknown): value is Readonly<Record<string, number>> =>
  isRecord(value) && Object.values(value).every(isFinitePriceNumber);

/** Validates a stored value as a price cache; anything else is discarded. */
export const isPriceCache = (value: unknown): value is PriceCache =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "attempted",
    "changes",
    "checked",
    "fetchedAt",
    "prices",
    "refreshed",
  ]) &&
  isFinitePriceNumber(value["fetchedAt"]) &&
  (value["attempted"] === undefined || isTimestampMap(value["attempted"])) &&
  (value["refreshed"] === undefined || isTimestampMap(value["refreshed"])) &&
  (value["checked"] === undefined || isCheckedList(value["checked"])) &&
  (value["changes"] === undefined ||
    (isRecord(value["changes"]) && Object.values(value["changes"]).every(isFinitePriceNumber))) &&
  isRecord(value["prices"]) &&
  Object.values(value["prices"]).every(isPriceEntry);

const withinWindow = (at: number | undefined, currentTime: number, windowMs: number): boolean =>
  at !== undefined && at <= currentTime && currentTime - at < windowMs;

/** True when every wanted address was attempted within the retry backoff. */
export const recentPriceAttempt = (
  cache: PriceCache,
  wanted: readonly string[],
  currentTime: number,
): boolean =>
  wanted.every((address) =>
    withinWindow(cache.attempted?.[address], currentTime, PRICE_RETRY_BACKOFF_MS),
  );

/**
 * True only when the feed answered for every wanted address within the TTL.
 * An address with no recorded refresh (including any cache written before
 * per-address tracking) fails closed as not fresh.
 */
export const pricesFresh = (
  cache: PriceCache,
  wanted: readonly string[],
  currentTime: number,
): boolean =>
  wanted.every((address) => withinWindow(cache.refreshed?.[address], currentTime, PRICE_TTL_MS));

/**
 * The capture time to report for the wanted addresses: the oldest refresh
 * among those that contribute a price, or among the refreshed ones when none
 * is priced. Null when a contributing price has no vouched age.
 */
export const oldestRefresh = (cache: PriceCache, wanted: readonly string[]): number | null => {
  const priced = wanted.filter((address) => cache.prices[address] !== undefined);
  const basis =
    priced.length > 0
      ? priced
      : wanted.filter((address) => cache.refreshed?.[address] !== undefined);
  if (basis.length === 0) return null;
  const oldest = Math.min(...basis.map((address) => cache.refreshed?.[address] ?? 0));
  return oldest > 0 ? oldest : null;
};

/** True when every wanted address is either priced or known to be unlisted. */
export const cacheCovers = (cache: PriceCache, wanted: readonly string[]): boolean => {
  const known = new Set([...Object.keys(cache.prices), ...(cache.checked ?? [])]);
  return wanted.every((address) => known.has(address));
};

/** A copy of `record` without the given keys. */
const withoutKeys = <T>(
  record: Readonly<Record<string, T>>,
  keys: ReadonlySet<string>,
): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !keys.has(key)));

/**
 * Folds the answered outcomes into the cache, stamping a refresh time only on
 * the addresses that actually answered so a failed leg keeps its old age.
 *
 * An address the feed answered without a usable price (an empty body, or an
 * entry missing a currency) loses its previously cached price: the refresh
 * stamp vouches for what the cache now holds, so it must not freshen an old
 * price the feed no longer stands behind. Keeping it would let a months-old
 * STRK price bound the STRK20 relay fee as if current (mc-wallet #357).
 */
export const mergeAnsweredPrices = (
  cache: PriceCache,
  answered: readonly PriceOutcome[],
  answeredAt: number,
): Omit<PriceCache, "attempted" | "fetchedAt"> => {
  const fetched = Object.assign(
    {},
    ...answered.map((outcome) => (outcome.ok ? outcome.prices : {})),
  ) as Record<string, PriceEntry>;
  const fetchedChanges = Object.assign(
    {},
    ...answered.map((outcome) => (outcome.ok ? outcome.changes : {})),
  ) as Record<string, number>;
  const unpriced = new Set(
    answered.map((outcome) => outcome.address).filter((address) => fetched[address] === undefined),
  );
  return {
    changes: { ...withoutKeys(cache.changes ?? {}, unpriced), ...fetchedChanges },
    checked: [
      ...new Set([...(cache.checked ?? []), ...answered.map((outcome) => outcome.address)]),
    ],
    prices: { ...withoutKeys(cache.prices, unpriced), ...fetched },
    refreshed: {
      ...(cache.refreshed ?? {}),
      ...Object.fromEntries(answered.map((outcome) => [outcome.address, answeredAt])),
    },
  };
};
