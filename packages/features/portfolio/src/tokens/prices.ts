/** Cached fiat prices and charts with bounded, last-known-good storage. */
import type { BoundedHttpFetch, BoundedHttpResponse } from "@mc-wallet/core/http-json";
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import type { KeyValueStore } from "@mc-wallet/store/kv";
import type { StarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import type { DisplayCurrency } from "@mc-wallet/wallet-model/preferences";
import {
  fetchAddressPrices,
  fetchChartPoints,
  isFinitePriceNumber,
  normalizePriceAddress,
  PRICE_CHART_POINT_LIMIT,
  type PriceEntry,
  type PriceOutcome,
  priceFeedPlatform,
} from "./prices-feed";

export { PRICE_CHART_POINT_LIMIT } from "./prices-feed";

/** Browser storage key for the fiat price cache. */
const PRICES_STORE_KEY = "mc-wallet:prices";

/**
 * Browser storage key for the 7-day market chart cache.
 */
export const CHARTS_STORE_KEY = "mc-wallet:charts";

const PRICE_TTL_MS = 5 * 60 * 1000;
const PRICE_RETRY_BACKOFF_MS = 60_000;
const CHART_TTL_MS = 30 * 60 * 1000;
const MAX_ADDRESSES = 50;
const MAX_CHART_ENTRIES = 50;

/**
 * Minimal HTTP response subset consumed from the injected fetch: the shared
 * bounded-read shape, so an oversized price body is cut off at the transport
 * rather than parsed into the worker.
 */
export type HttpResponse = BoundedHttpResponse;

/**
 * Injectable network fetch used only by the background worker. It receives the
 * request options the boundary chose (no cookies, no referrer, redirects
 * refused) and the deadline signal, and must forward both to the real `fetch`
 * so a hung host releases its socket as well as its caller.
 */
export type HttpFetch = BoundedHttpFetch;

/**
 * Inputs for reading fiat prices for tracked token contracts.
 */
export type TokenPriceInput = {
  readonly addresses: readonly string[];
  readonly cached?: true;
  readonly currency: DisplayCurrency;
  readonly networkId: StarknetNetworkId;
};

/**
 * Fiat prices keyed by the requested contract address. `asOf` is the epoch (ms)
 * the returned snapshot was captured, or null when nothing is cached / fiat is
 * not applicable (off mainnet). `stale` is true when the live host could not be
 * reached and these values were served from the last-known-good cache, so the
 * UI can label them rather than pass them off as current.
 */
export type TokenPrices = {
  readonly asOf: number | null;
  readonly changes: Readonly<Record<string, number>>;
  readonly currency: DisplayCurrency;
  readonly prices: Readonly<Record<string, number>>;
  readonly stale: boolean;
};

/**
 * Inputs for reading a token's recent price series.
 */
export type TokenChartInput = {
  readonly address: string;
  readonly currency: DisplayCurrency;
  readonly networkId: StarknetNetworkId;
};

/**
 * A token's recent fiat price series for a sparkline.
 */
export type TokenChart = {
  readonly currency: DisplayCurrency;
  readonly points: readonly number[];
};

/**
 * Injectable price feed used by the background message handler.
 */
export type PriceService = {
  readonly getPrices: (input: TokenPriceInput) => Promise<TokenPrices>;
  readonly getTokenChart: (input: TokenChartInput) => Promise<TokenChart>;
};

type PriceCache = {
  readonly attempted?: Readonly<Record<string, number>>;
  readonly changes?: Readonly<Record<string, number>>;
  readonly checked?: readonly string[];
  readonly fetchedAt: number;
  readonly prices: Readonly<Record<string, PriceEntry>>;
};
type ChartEntry = {
  readonly attemptedAt?: number;
  readonly fetchedAt: number;
  readonly points: readonly number[];
};
type ChartCache = Readonly<Record<string, ChartEntry>>;

const CURRENCIES: readonly DisplayCurrency[] = ["eur", "gbp", "usd"];

const parseChartEntry = (value: unknown): ChartEntry | null => {
  if (
    !isRecord(value) ||
    !isFinitePriceNumber(value["fetchedAt"]) ||
    (value["attemptedAt"] !== undefined && !isFinitePriceNumber(value["attemptedAt"])) ||
    !Array.isArray(value["points"])
  ) {
    return null;
  }
  return {
    ...(value["attemptedAt"] === undefined ? {} : { attemptedAt: value["attemptedAt"] }),
    fetchedAt: value["fetchedAt"],
    points: value["points"].filter(isFinitePriceNumber).slice(0, PRICE_CHART_POINT_LIMIT),
  };
};

const recentPriceAttempt = (
  cache: PriceCache,
  wanted: readonly string[],
  currentTime: number,
): boolean =>
  wanted.every((address) => {
    const attemptedAt = cache.attempted?.[address];
    return (
      attemptedAt !== undefined &&
      attemptedAt <= currentTime &&
      currentTime - attemptedAt < PRICE_RETRY_BACKOFF_MS
    );
  });

const reusablePrices = (input: {
  readonly addresses: readonly string[];
  readonly cache: PriceCache;
  readonly cachedOnly: boolean;
  readonly currency: DisplayCurrency;
  readonly currentTime: number;
  readonly wanted: readonly string[];
}): TokenPrices | null => {
  const { addresses, cache, cachedOnly, currency, currentTime, wanted } = input;
  if (wanted.length === 0) {
    return projectPrices({
      addresses,
      asOf: null,
      changes: cache.changes ?? {},
      currency,
      prices: cache.prices,
      stale: false,
    });
  }
  if (cachedOnly) {
    return projectPrices({
      addresses,
      asOf: snapshotAsOf(cache.fetchedAt),
      changes: cache.changes ?? {},
      currency,
      prices: cache.prices,
      stale: !isCacheFresh(cache, currentTime),
    });
  }
  if (isCacheFresh(cache, currentTime) && cacheCovers(cache, wanted)) {
    return projectPrices({
      addresses,
      asOf: snapshotAsOf(cache.fetchedAt),
      changes: cache.changes ?? {},
      currency,
      prices: cache.prices,
      stale: false,
    });
  }
  if (!recentPriceAttempt(cache, wanted, currentTime)) return null;
  return projectPrices({
    addresses,
    asOf: snapshotAsOf(cache.fetchedAt),
    changes: cache.changes ?? {},
    currency,
    prices: cache.prices,
    stale: true,
  });
};

const cachedChartPoints = (
  platform: string | null,
  cached: ChartEntry | undefined,
  currentTime: number,
): readonly number[] | null => {
  if (!platform) return cached?.points ?? [];
  if (cached && cached.fetchedAt > 0 && currentTime - cached.fetchedAt < CHART_TTL_MS) {
    return cached.points;
  }
  if (
    cached?.attemptedAt !== undefined &&
    cached.attemptedAt <= currentTime &&
    currentTime - cached.attemptedAt < PRICE_RETRY_BACKOFF_MS
  ) {
    return cached.points;
  }
  return null;
};

const snapshotAsOf = (fetchedAt: number): number | null => (fetchedAt > 0 ? fetchedAt : null);

const isPriceEntry = (value: unknown): value is PriceEntry =>
  isRecord(value) && CURRENCIES.every((currency) => isFinitePriceNumber(value[currency]));

const isCheckedList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isTimestampMap = (value: unknown): value is Readonly<Record<string, number>> =>
  isRecord(value) && Object.values(value).every(isFinitePriceNumber);

const isPriceCache = (value: unknown): value is PriceCache =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["attempted", "changes", "checked", "fetchedAt", "prices"]) &&
  isFinitePriceNumber(value["fetchedAt"]) &&
  (value["attempted"] === undefined || isTimestampMap(value["attempted"])) &&
  (value["checked"] === undefined || isCheckedList(value["checked"])) &&
  (value["changes"] === undefined ||
    (isRecord(value["changes"]) && Object.values(value["changes"]).every(isFinitePriceNumber))) &&
  isRecord(value["prices"]) &&
  Object.values(value["prices"]).every(isPriceEntry);

const sliceCurrency = (
  prices: Readonly<Record<string, PriceEntry>>,
  addresses: readonly string[],
  currency: DisplayCurrency,
): Record<string, number> => {
  const slice: Record<string, number> = {};
  for (const address of addresses) {
    const entry = prices[normalizePriceAddress(address)];
    if (entry) {
      slice[address] = entry[currency];
    }
  }
  return slice;
};

const sliceChanges = (
  changes: Readonly<Record<string, number>>,
  addresses: readonly string[],
): Record<string, number> => {
  const slice: Record<string, number> = {};
  for (const address of addresses) {
    const change = changes[normalizePriceAddress(address)];
    if (change !== undefined) {
      slice[address] = change;
    }
  }
  return slice;
};

const isCacheFresh = (cache: PriceCache, nowMs: number): boolean =>
  nowMs - cache.fetchedAt < PRICE_TTL_MS;

const cacheCovers = (cache: PriceCache, wanted: readonly string[]): boolean => {
  const known = new Set([...Object.keys(cache.prices), ...(cache.checked ?? [])]);
  return wanted.every((address) => known.has(address));
};

const mergeAnsweredPrices = (
  cache: PriceCache,
  answered: readonly PriceOutcome[],
): {
  readonly checked: readonly string[];
  readonly mergedChanges: Record<string, number>;
  readonly mergedPrices: Record<string, PriceEntry>;
} => {
  const fetched = Object.assign(
    {},
    ...answered.map((outcome) => (outcome.ok ? outcome.prices : {})),
  ) as Record<string, PriceEntry>;
  const fetchedChanges = Object.assign(
    {},
    ...answered.map((outcome) => (outcome.ok ? outcome.changes : {})),
  ) as Record<string, number>;
  return {
    checked: [
      ...new Set([...(cache.checked ?? []), ...answered.map((outcome) => outcome.address)]),
    ],
    mergedChanges: { ...(cache.changes ?? {}), ...fetchedChanges },
    mergedPrices: { ...cache.prices, ...fetched },
  };
};

const projectPrices = (input: {
  readonly addresses: readonly string[];
  readonly asOf: number | null;
  readonly changes: Readonly<Record<string, number>>;
  readonly currency: DisplayCurrency;
  readonly prices: Readonly<Record<string, PriceEntry>>;
  readonly stale: boolean;
}): TokenPrices => ({
  asOf: input.asOf,
  changes: sliceChanges(input.changes, input.addresses),
  currency: input.currency,
  prices: sliceCurrency(input.prices, input.addresses, input.currency),
  stale: input.stale,
});

/**
 * Creates the CoinGecko-backed price service with a storage cache and an
 * injected clock and fetch. Missing prices and network failures resolve to
 * cached-or-empty rather than throwing.
 */
export const createPriceService = ({
  http,
  now = () => Date.now(),
  store,
}: {
  readonly http: HttpFetch;
  readonly now?: () => number;
  readonly store: KeyValueStore;
}): PriceService => {
  const readPriceCache = async (): Promise<PriceCache> => {
    const stored = await store.get(PRICES_STORE_KEY).catch(() => undefined);
    return isPriceCache(stored) ? stored : { fetchedAt: 0, prices: {} };
  };

  const readChartCache = async (): Promise<ChartCache> => {
    const stored = await store.get(CHARTS_STORE_KEY).catch(() => undefined);
    if (!isRecord(stored)) return {};
    const entries: Record<string, ChartEntry> = {};
    for (const [key, value] of Object.entries(stored)) {
      const parsed = parseChartEntry(value);
      if (parsed) entries[key] = parsed;
    }
    return entries;
  };

  const capChartCache = (
    entries: Readonly<Record<string, ChartEntry>>,
  ): Record<string, ChartEntry> => {
    const pairs = Object.entries(entries);
    if (pairs.length <= MAX_CHART_ENTRIES) {
      return { ...entries };
    }
    const kept = pairs
      .sort(([, left], [, right]) => right.fetchedAt - left.fetchedAt)
      .slice(0, MAX_CHART_ENTRIES);
    return Object.fromEntries(kept);
  };

  const fetchAndStorePrices = async (
    cache: PriceCache,
    platform: string,
    wanted: readonly string[],
    addresses: readonly string[],
    currency: DisplayCurrency,
  ): Promise<TokenPrices> => {
    const attemptedAt = now();
    const attempted = {
      ...(cache.attempted ?? {}),
      ...Object.fromEntries(wanted.map((address) => [address, attemptedAt])),
    };
    const outcomes = await Promise.all(
      wanted.map((address) => fetchAddressPrices(http, platform, address)),
    );
    const answered = outcomes.filter((outcome) => outcome.ok);
    if (answered.length === 0) {
      await store.set(PRICES_STORE_KEY, { ...cache, attempted }).catch(() => undefined);
      return projectPrices({
        addresses,
        asOf: snapshotAsOf(cache.fetchedAt),
        changes: cache.changes ?? {},
        currency,
        prices: cache.prices,
        stale: true,
      });
    }
    const { checked, mergedChanges, mergedPrices } = mergeAnsweredPrices(cache, answered);
    const answeredAddresses = new Set(answered.map((outcome) => outcome.address));
    await store
      .set(PRICES_STORE_KEY, {
        attempted,
        changes: mergedChanges,
        checked,
        fetchedAt: attemptedAt,
        prices: mergedPrices,
      })
      .catch(() => undefined);
    const unanswered = wanted.filter((address) => !answeredAddresses.has(address));
    if (unanswered.length === 0) {
      return projectPrices({
        addresses,
        asOf: attemptedAt,
        changes: mergedChanges,
        currency,
        prices: mergedPrices,
        stale: false,
      });
    }
    const servesCachedPrice = unanswered.some((address) => mergedPrices[address] !== undefined);
    return projectPrices({
      addresses,
      asOf: servesCachedPrice ? snapshotAsOf(cache.fetchedAt) : attemptedAt,
      changes: mergedChanges,
      currency,
      prices: mergedPrices,
      stale: true,
    });
  };

  return {
    async getPrices({ addresses, cached, currency, networkId }) {
      const platform = priceFeedPlatform(networkId);
      const wanted = [...new Set(addresses.map(normalizePriceAddress))].slice(0, MAX_ADDRESSES);
      const cache = await readPriceCache();
      const currentTime = now();
      if (!platform) {
        return projectPrices({
          addresses,
          asOf: null,
          changes: cache.changes ?? {},
          currency,
          prices: cache.prices,
          stale: false,
        });
      }
      const reusable = reusablePrices({
        addresses,
        cache,
        cachedOnly: cached === true,
        currency,
        currentTime,
        wanted,
      });
      if (reusable) return reusable;
      return fetchAndStorePrices(cache, platform, wanted, addresses, currency);
    },
    async getTokenChart({ address, currency, networkId }) {
      const platform = priceFeedPlatform(networkId);
      const key = `${normalizePriceAddress(address)}:${currency}`;
      const cache = await readChartCache();
      const cached = cache[key];
      const currentTime = now();
      const available = cachedChartPoints(platform, cached, currentTime);
      if (!platform) return { currency, points: available ?? [] };
      if (available) return { currency, points: available };
      const retainAfterFailure = async (): Promise<readonly number[]> => {
        const points = cached?.points ?? [];
        await store
          .set(
            CHARTS_STORE_KEY,
            capChartCache({
              ...cache,
              [key]: { attemptedAt: currentTime, fetchedAt: cached?.fetchedAt ?? 0, points },
            }),
          )
          .catch(() => undefined);
        return points;
      };
      try {
        const points = await fetchChartPoints(http, platform, address, currency);
        if (points.length === 0) {
          return { currency, points: await retainAfterFailure() };
        }
        await store
          .set(
            CHARTS_STORE_KEY,
            capChartCache({
              ...cache,
              [key]: { attemptedAt: currentTime, fetchedAt: currentTime, points },
            }),
          )
          .catch(() => undefined);
        return { currency, points };
      } catch {
        return { currency, points: await retainAfterFailure() };
      }
    },
  };
};

/**
 * Offline price service used when no background feed is wired; always empty.
 */
export const unavailablePriceService: PriceService = {
  async getPrices({ currency }) {
    return { asOf: null, changes: {}, currency, prices: {}, stale: false };
  },
  async getTokenChart({ currency }) {
    return { currency, points: [] };
  },
};
