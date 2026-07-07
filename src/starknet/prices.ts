/**
 * CoinGecko price feed for tracked Starknet tokens, with an in-storage cache.
 *
 * Network access is injected (`http`) so this module stays pure at its edges
 * and testable without a real network; the background worker wires the real
 * `fetch`. Prices are cached under `mc-wallet:prices` and 7-day charts under
 * `mc-wallet:charts` with a TTL clock injected the way the activity store
 * takes one. Every failure degrades to cached-or-empty so the UI can simply
 * omit fiat when offline.
 */
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import type { KeyValueStore } from "../storage/kv";
import type { DisplayCurrency } from "../storage/preferences-store";
import type { StarknetNetworkId } from "./networks";

/**
 * Browser storage key for the fiat price cache.
 */
export const PRICES_STORE_KEY = "mc-wallet:prices";

/**
 * Browser storage key for the 7-day market chart cache.
 */
export const CHARTS_STORE_KEY = "mc-wallet:charts";

const PRICE_TTL_MS = 5 * 60 * 1000;
const CHART_TTL_MS = 30 * 60 * 1000;
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const MAX_ADDRESSES = 50;
const CHART_DAYS = 7;

// CoinGecko platform id; only Starknet mainnet has fiat coverage.
const PLATFORM_FOR_NETWORK: Readonly<Partial<Record<StarknetNetworkId, string>>> = {
  SN_MAIN: "starknet",
};

/**
 * Minimal HTTP response subset consumed from the injected fetch.
 */
export type HttpResponse = {
  readonly json: () => Promise<unknown>;
  readonly ok: boolean;
};

/**
 * Injectable network fetch used only by the background worker.
 */
export type HttpFetch = (url: string) => Promise<HttpResponse>;

/**
 * Inputs for reading fiat prices for tracked token contracts.
 */
export type TokenPriceInput = {
  readonly addresses: readonly string[];
  readonly currency: DisplayCurrency;
  readonly networkId: StarknetNetworkId;
};

/**
 * Fiat prices keyed by the requested contract address.
 */
export type TokenPrices = {
  readonly currency: DisplayCurrency;
  readonly prices: Readonly<Record<string, number>>;
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

type PriceEntry = Readonly<Record<DisplayCurrency, number>>;
type PriceCache = {
  readonly fetchedAt: number;
  readonly prices: Readonly<Record<string, PriceEntry>>;
};
type ChartEntry = { readonly fetchedAt: number; readonly points: readonly number[] };
type ChartCache = Readonly<Record<string, ChartEntry>>;

const CURRENCIES: readonly DisplayCurrency[] = ["eur", "gbp", "usd"];

// Canonical padded lowercase Starknet address, matching how contract indexes
// (and CoinGecko's Starknet platform) key tokens.
const normalizeAddress = (address: string): string => {
  try {
    return `0x${BigInt(address).toString(16).padStart(64, "0")}`;
  } catch {
    return address.toLowerCase();
  }
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isPriceEntry = (value: unknown): value is PriceEntry =>
  isRecord(value) && CURRENCIES.every((currency) => isFiniteNumber(value[currency]));

const isPriceCache = (value: unknown): value is PriceCache =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["fetchedAt", "prices"]) &&
  isFiniteNumber(value.fetchedAt) &&
  isRecord(value.prices) &&
  Object.values(value.prices).every(isPriceEntry);

const readJsonRecord = async (http: HttpFetch, url: string): Promise<Record<string, unknown>> => {
  const response = await http(url);
  if (!response.ok) {
    throw new Error("price request failed");
  }
  const body = await response.json();
  return isRecord(body) ? body : {};
};

// Parses the CoinGecko simple/token_price body into address -> currency prices.
const parsePriceBody = (body: Record<string, unknown>): Record<string, PriceEntry> => {
  const parsed: Record<string, PriceEntry> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!isRecord(value)) {
      continue;
    }
    const usd = value.usd;
    const eur = value.eur;
    const gbp = value.gbp;
    if (isFiniteNumber(usd) && isFiniteNumber(eur) && isFiniteNumber(gbp)) {
      parsed[normalizeAddress(key)] = { eur, gbp, usd };
    }
  }
  return parsed;
};

// Extracts the price column from a CoinGecko market_chart response.
const parseChartBody = (body: Record<string, unknown>): readonly number[] => {
  const series = body.prices;
  if (!Array.isArray(series)) {
    return [];
  }
  const points: number[] = [];
  for (const pair of series) {
    if (Array.isArray(pair) && isFiniteNumber(pair[1])) {
      points.push(pair[1]);
    }
  }
  return points;
};

const sliceCurrency = (
  prices: Readonly<Record<string, PriceEntry>>,
  addresses: readonly string[],
  currency: DisplayCurrency,
): Record<string, number> => {
  const slice: Record<string, number> = {};
  for (const address of addresses) {
    const entry = prices[normalizeAddress(address)];
    if (entry) {
      slice[address] = entry[currency];
    }
  }
  return slice;
};

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
      if (isRecord(value) && isFiniteNumber(value.fetchedAt) && Array.isArray(value.points)) {
        entries[key] = { fetchedAt: value.fetchedAt, points: value.points.filter(isFiniteNumber) };
      }
    }
    return entries;
  };

  return {
    async getPrices({ addresses, currency, networkId }) {
      const platform = PLATFORM_FOR_NETWORK[networkId];
      const wanted = [...new Set(addresses.map(normalizeAddress))].slice(0, MAX_ADDRESSES);
      const cache = await readPriceCache();
      const fresh = now() - cache.fetchedAt < PRICE_TTL_MS;
      const covered = wanted.every((address) => cache.prices[address] !== undefined);
      if (!platform || wanted.length === 0 || (fresh && covered)) {
        return { currency, prices: sliceCurrency(cache.prices, addresses, currency) };
      }
      try {
        const url = `${COINGECKO_BASE}/simple/token_price/${platform}?contract_addresses=${encodeURIComponent(wanted.join(","))}&vs_currencies=usd,eur,gbp`;
        const fetched = parsePriceBody(await readJsonRecord(http, url));
        const merged = { ...cache.prices, ...fetched };
        await store
          .set(PRICES_STORE_KEY, { fetchedAt: now(), prices: merged })
          .catch(() => undefined);
        return { currency, prices: sliceCurrency(merged, addresses, currency) };
      } catch {
        return { currency, prices: sliceCurrency(cache.prices, addresses, currency) };
      }
    },
    async getTokenChart({ address, currency, networkId }) {
      const platform = PLATFORM_FOR_NETWORK[networkId];
      const key = `${normalizeAddress(address)}:${currency}`;
      const cache = await readChartCache();
      const cached = cache[key];
      if (!platform) {
        return { currency, points: cached?.points ?? [] };
      }
      if (cached && now() - cached.fetchedAt < CHART_TTL_MS) {
        return { currency, points: cached.points };
      }
      try {
        const url = `${COINGECKO_BASE}/coins/${platform}/contract/${normalizeAddress(address)}/market_chart?vs_currency=${currency}&days=${CHART_DAYS}`;
        const points = parseChartBody(await readJsonRecord(http, url));
        await store
          .set(CHARTS_STORE_KEY, { ...cache, [key]: { fetchedAt: now(), points } })
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
    return { currency, prices: {} };
  },
  async getTokenChart({ currency }) {
    return { currency, points: [] };
  },
};
