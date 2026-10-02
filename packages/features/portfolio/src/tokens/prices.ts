/** Cached fiat prices and charts with bounded, last-known-good storage. */
import type { BoundedHttpFetch, BoundedHttpResponse } from "@bramble/core/http-json";
import { isRecord } from "@bramble/core/json";
import type { KeyValueStore } from "@bramble/store/kv";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import type { DisplayCurrency } from "@bramble/wallet-model/preferences";
import {
  cacheCovers,
  isPriceCache,
  mergeAnsweredPrices,
  oldestRefresh,
  PRICE_RETRY_BACKOFF_MS,
  type PriceCache,
  pricesFresh,
  recentPriceAttempt,
} from "./prices-cache";
import {
  fetchAddressPrices,
  fetchChartPoints,
  isFinitePriceNumber,
  normalizePriceAddress,
  PRICE_CHART_POINT_LIMIT,
  type PriceEntry,
  priceFeedPlatform,
} from "./prices-feed";

export { PRICE_CHART_POINT_LIMIT } from "./prices-feed";

/** Browser storage key for the fiat price cache. */
const PRICES_STORE_KEY = "bramble:prices";

/**
 * Browser storage key for the 7-day market chart cache.
 */
export const CHARTS_STORE_KEY = "bramble:charts";

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

type ChartEntry = {
  readonly attemptedAt?: number;
  readonly fetchedAt: number;
  readonly points: readonly number[];
};
type ChartCache = Readonly<Record<string, ChartEntry>>;

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
      asOf: oldestRefresh(cache, wanted),
      changes: cache.changes ?? {},
      currency,
      prices: cache.prices,
      stale: !pricesFresh(cache, wanted, currentTime),
    });
  }
  if (pricesFresh(cache, wanted, currentTime) && cacheCovers(cache, wanted)) {
    return projectPrices({
      addresses,
      asOf: oldestRefresh(cache, wanted),
      changes: cache.changes ?? {},
      currency,
      prices: cache.prices,
      stale: false,
    });
  }
  if (!recentPriceAttempt(cache, wanted, currentTime)) return null;
  return projectPrices({
    addresses,
    asOf: oldestRefresh(cache, wanted),
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
        asOf: oldestRefresh(cache, wanted),
        changes: cache.changes ?? {},
        currency,
        prices: cache.prices,
        stale: true,
      });
    }
    const merged: PriceCache = {
      ...mergeAnsweredPrices(cache, answered, attemptedAt),
      attempted,
      fetchedAt: attemptedAt,
    };
    await store.set(PRICES_STORE_KEY, merged).catch(() => undefined);
    // Each address carries its own age, so a leg that failed this round keeps
    // the old capture time and marks the whole answer stale.
    return projectPrices({
      addresses,
      asOf: oldestRefresh(merged, wanted),
      changes: merged.changes ?? {},
      currency,
      prices: merged.prices,
      stale: !pricesFresh(merged, wanted, attemptedAt),
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
