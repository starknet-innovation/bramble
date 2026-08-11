/**
 * CoinGecko wire boundary for the fiat price feed.
 *
 * This module owns the outward conversation only: which URLs the wallet asks
 * for, and how the untrusted bodies that come back are read and parsed. The
 * cached snapshot, its TTL, and the service that serves it live in `./prices`,
 * which depends on this module and never the other way round — so the code that
 * touches a hostile response is auditable on its own.
 *
 * Every read goes through {@link fetchBoundedJson}: a size cap and a deadline,
 * with cookies, referrer, and redirect-following withheld. Nothing here trusts
 * a field it did not validate — a body that is missing, misshapen, or partially
 * numeric contributes only the entries that parse, and a failed request is
 * reported as such so the caller can fall back to its cache rather than
 * publishing zeros.
 */
import { type BoundedHttpFetch, fetchBoundedJson, HTTP_BODY_LIMITS } from "../shared/http-json";
import { isRecord } from "../shared/json";
import type { DisplayCurrency } from "../storage/preferences-store";
import type { StarknetNetworkId } from "./networks";
import { canonicalAddress } from "./networks";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const CHART_DAYS = 7;

// CoinGecko platform id; only Starknet mainnet has fiat coverage.
const PLATFORM_FOR_NETWORK: Readonly<Partial<Record<StarknetNetworkId, string>>> = {
  SN_MAIN: "starknet",
};

/**
 * One token's price in every currency the wallet can display. All three are
 * present or the entry is not stored, so a currency switch never blanks a row
 * that was priced a moment ago.
 */
export type PriceEntry = Readonly<Record<DisplayCurrency, number>>;

/**
 * One address's price-request result: parsed prices and 24h changes when the
 * request answered, or just the address on failure so the caller keeps treating
 * it as uncovered rather than as priced-at-nothing.
 */
export type PriceOutcome =
  | {
      readonly address: string;
      readonly changes: Record<string, number>;
      readonly ok: true;
      readonly prices: Record<string, PriceEntry>;
    }
  | { readonly address: string; readonly ok: false };

/**
 * The CoinGecko platform id for a network, or null where fiat coverage does not
 * exist (every non-mainnet network). Null means "no fiat by design", which the
 * caller must not present as a stale or failed price.
 */
export const priceFeedPlatform = (networkId: StarknetNetworkId): string | null =>
  PLATFORM_FOR_NETWORK[networkId] ?? null;

/**
 * The single spelling this feed keys tokens by: the shared canonical address
 * (lowercase, zero-padded), which is also how CoinGecko's Starknet platform
 * keys them. Input that is not a field element is only lowercased, so it stays
 * distinguishable instead of collapsing onto a valid address.
 */
export const normalizePriceAddress = (address: string): string =>
  canonicalAddress(address) ?? address.trim().toLowerCase();

/**
 * Checks a value is a usable numeric reading from an untrusted body: a finite
 * number, never NaN or an infinity that would render as a broken price.
 */
export const isFinitePriceNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const readJsonRecord = async (
  http: BoundedHttpFetch,
  url: string,
): Promise<Record<string, unknown>> => {
  const body = await fetchBoundedJson(http, url, HTTP_BODY_LIMITS.price);
  return isRecord(body) ? body : {};
};

// Parses the CoinGecko simple/token_price body into address -> currency prices.
const parsePriceBody = (body: Record<string, unknown>): Record<string, PriceEntry> => {
  const parsed: Record<string, PriceEntry> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!isRecord(value)) {
      continue;
    }
    const usd = value["usd"];
    const eur = value["eur"];
    const gbp = value["gbp"];
    if (isFinitePriceNumber(usd) && isFinitePriceNumber(eur) && isFinitePriceNumber(gbp)) {
      parsed[normalizePriceAddress(key)] = { eur, gbp, usd };
    }
  }
  return parsed;
};

// Extracts the 24h percent change per address from a CoinGecko body carrying
// include_24hr_change=true (usd_24h_change).
const parseChanges = (body: Record<string, unknown>): Record<string, number> => {
  const parsed: Record<string, number> = {};
  for (const [key, value] of Object.entries(body)) {
    if (isRecord(value) && isFinitePriceNumber(value["usd_24h_change"])) {
      parsed[normalizePriceAddress(key)] = value["usd_24h_change"];
    }
  }
  return parsed;
};

// Extracts the price column from a CoinGecko market_chart response.
const parseChartBody = (body: Record<string, unknown>): readonly number[] => {
  const series = body["prices"];
  if (!Array.isArray(series)) {
    return [];
  }
  const points: number[] = [];
  for (const pair of series) {
    if (Array.isArray(pair) && isFinitePriceNumber(pair[1])) {
      points.push(pair[1]);
    }
  }
  return points;
};

const priceRequestUrl = (platform: string, address: string): string =>
  `${COINGECKO_BASE}/simple/token_price/${platform}?contract_addresses=${encodeURIComponent(address)}&vs_currencies=usd,eur,gbp&include_24hr_change=true`;

/**
 * Fetches and parses one address on its own request. Never throws: a transport
 * failure, a non-ok status, an over-budget body, a timed-out exchange, or a
 * body that is not JSON all resolve to an `ok: false` outcome, so the caller
 * distinguishes "we could not ask" from "the feed does not price this token".
 */
export const fetchAddressPrices = (
  http: BoundedHttpFetch,
  platform: string,
  address: string,
): Promise<PriceOutcome> =>
  readJsonRecord(http, priceRequestUrl(platform, address))
    .then(
      (body) =>
        ({ address, changes: parseChanges(body), ok: true, prices: parsePriceBody(body) }) as const,
    )
    .catch(() => ({ address, ok: false }) as const);

/**
 * Fetches a token's recent fiat price series. Throws on any transport, budget,
 * deadline, or parse failure so the caller can keep serving its cached series
 * instead of caching an empty one.
 */
export const fetchChartPoints = async (
  http: BoundedHttpFetch,
  platform: string,
  address: string,
  currency: DisplayCurrency,
): Promise<readonly number[]> => {
  const url = `${COINGECKO_BASE}/coins/${platform}/contract/${normalizePriceAddress(address)}/market_chart?vs_currency=${currency}&days=${CHART_DAYS}`;
  return parseChartBody(await readJsonRecord(http, url));
};
