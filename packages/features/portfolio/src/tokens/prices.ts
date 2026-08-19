/**
 * Cached fiat price service for tracked Starknet tokens.
 *
 * The outward CoinGecko conversation — request URLs and untrusted body parsing,
 * under a size cap and a deadline — lives in `./prices-feed`; this module owns
 * what the wallet keeps and what it serves. Network access is injected (`http`)
 * so this module stays pure at its edges and testable without a real network;
 * the background worker wires the real `fetch`. Prices are cached under
 * `mc-wallet:prices` and 7-day charts under `mc-wallet:charts` with a TTL clock
 * injected the way the activity store takes one. Every failure degrades to
 * cached-or-empty: when the host is unreachable the last-known-good prices are
 * still served, flagged `stale` with the `asOf` capture time so the UI can
 * present them as saved values (or an explicit "unavailable" hint when nothing
 * is cached) instead of vanishing.
 */
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

/**
 * Browser storage key for the fiat price cache.
 */
const PRICES_STORE_KEY = "mc-wallet:prices";

/**
 * Browser storage key for the 7-day market chart cache.
 */
export const CHARTS_STORE_KEY = "mc-wallet:charts";

const PRICE_TTL_MS = 5 * 60 * 1000;
const CHART_TTL_MS = 30 * 60 * 1000;
const MAX_ADDRESSES = 50;
// Bounds the persisted chart cache so a churn of one-off token views cannot grow
// storage without limit; the oldest-fetched entries are evicted first.
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

// `checked` records every address queried at `fetchedAt`, priced or not, so an
// address CoinGecko never prices (custom/spam tokens) still counts as covered
// until the TTL lapses instead of forcing a refetch on every call.
type PriceCache = {
  readonly changes?: Readonly<Record<string, number>>;
  readonly checked?: readonly string[];
  readonly fetchedAt: number;
  readonly prices: Readonly<Record<string, PriceEntry>>;
};
type ChartEntry = { readonly fetchedAt: number; readonly points: readonly number[] };
type ChartCache = Readonly<Record<string, ChartEntry>>;

const CURRENCIES: readonly DisplayCurrency[] = ["eur", "gbp", "usd"];

// The epoch a cached snapshot was captured, or null when nothing has ever been
// stored (a zero clock means "never fetched", so there is no last-known time).
const snapshotAsOf = (fetchedAt: number): number | null => (fetchedAt > 0 ? fetchedAt : null);

const isPriceEntry = (value: unknown): value is PriceEntry =>
  isRecord(value) && CURRENCIES.every((currency) => isFinitePriceNumber(value[currency]));

const isCheckedList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isPriceCache = (value: unknown): value is PriceCache =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["changes", "checked", "fetchedAt", "prices"]) &&
  isFinitePriceNumber(value["fetchedAt"]) &&
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

// Maps cached 24h changes back onto the caller's original address keys.
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

// Whether every wanted address is covered by the cache — priced OR queried at
// the last fetch and simply unlisted; both valid until the TTL ends.
const cacheCovers = (cache: PriceCache, wanted: readonly string[]): boolean => {
  const known = new Set([...Object.keys(cache.prices), ...(cache.checked ?? [])]);
  return wanted.every((address) => known.has(address));
};

// Merges freshly answered prices/changes over the cache and records every
// answered address as checked.
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

// Projects a price snapshot back onto the caller's original address keys.
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
    if (!isRecord(stored)) {
      return {};
    }
    const entries: Record<string, ChartEntry> = {};
    for (const [key, value] of Object.entries(stored)) {
      if (
        isRecord(value) &&
        isFinitePriceNumber(value["fetchedAt"]) &&
        Array.isArray(value["points"])
      ) {
        entries[key] = {
          fetchedAt: value["fetchedAt"],
          points: value["points"].filter(isFinitePriceNumber).slice(0, PRICE_CHART_POINT_LIMIT),
        };
      }
    }
    return entries;
  };

  // Keeps only the most recently fetched entries so the persisted chart cache
  // stays bounded regardless of how many distinct tokens are ever viewed.
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

  // Fetches every wanted address in parallel, writes the merged snapshot to the
  // cache, and projects the result. Reached only when the cache did not already
  // cover the request.
  const fetchAndStorePrices = async (
    cache: PriceCache,
    platform: string,
    wanted: readonly string[],
    addresses: readonly string[],
    currency: DisplayCurrency,
  ): Promise<TokenPrices> => {
    const outcomes = await Promise.all(
      wanted.map((address) => fetchAddressPrices(http, platform, address)),
    );
    const answered = outcomes.filter((outcome) => outcome.ok);
    if (answered.length === 0) {
      // The host was unreachable for every address: fall back to the
      // last-known-good cache, flagged stale (or empty as an "unavailable" hint).
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
        changes: mergedChanges,
        checked,
        fetchedAt: now(),
        prices: mergedPrices,
      })
      .catch(() => undefined);
    // A partial fetch mixes just-fetched prices with older cached ones for the
    // failed addresses, so it is flagged stale and dated to the OLDEST capture
    // that still contributes (the cache time when a served price for a failed
    // address is cached, otherwise now()). Failed addresses with nothing cached
    // stay absent from `prices`, exactly as in the all-fail path.
    const unanswered = wanted.filter((address) => !answeredAddresses.has(address));
    if (unanswered.length === 0) {
      return projectPrices({
        addresses,
        asOf: now(),
        changes: mergedChanges,
        currency,
        prices: mergedPrices,
        stale: false,
      });
    }
    const servesCachedPrice = unanswered.some((address) => mergedPrices[address] !== undefined);
    return projectPrices({
      addresses,
      asOf: servesCachedPrice ? snapshotAsOf(cache.fetchedAt) : now(),
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
      // Off mainnet and empty requests carry no fiat by design (not "stale").
      if (!platform || wanted.length === 0) {
        return projectPrices({
          addresses,
          asOf: null,
          changes: cache.changes ?? {},
          currency,
          prices: cache.prices,
          stale: false,
        });
      }
      if (cached) {
        return projectPrices({
          addresses,
          asOf: snapshotAsOf(cache.fetchedAt),
          changes: cache.changes ?? {},
          currency,
          prices: cache.prices,
          stale: !isCacheFresh(cache, now()),
        });
      }
      // A fresh, fully-covered cache is a confirmed-current hit.
      if (isCacheFresh(cache, now()) && cacheCovers(cache, wanted)) {
        return projectPrices({
          addresses,
          asOf: snapshotAsOf(cache.fetchedAt),
          changes: cache.changes ?? {},
          currency,
          prices: cache.prices,
          stale: false,
        });
      }
      return fetchAndStorePrices(cache, platform, wanted, addresses, currency);
    },
    async getTokenChart({ address, currency, networkId }) {
      const platform = priceFeedPlatform(networkId);
      const key = `${normalizePriceAddress(address)}:${currency}`;
      const cache = await readChartCache();
      const cached = cache[key];
      if (!platform) {
        return { currency, points: cached?.points ?? [] };
      }
      if (cached && now() - cached.fetchedAt < CHART_TTL_MS) {
        return { currency, points: cached.points };
      }
      try {
        const points = await fetchChartPoints(http, platform, address, currency);
        // Never cache an empty series: caching [] would suppress retries until
        // the TTL and hide a chart that a transient failure merely omitted.
        if (points.length === 0) {
          return { currency, points: cached?.points ?? [] };
        }
        await store
          .set(CHARTS_STORE_KEY, capChartCache({ ...cache, [key]: { fetchedAt: now(), points } }))
          .catch(() => undefined);
        return { currency, points };
      } catch {
        return { currency, points: cached?.points ?? [] };
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
