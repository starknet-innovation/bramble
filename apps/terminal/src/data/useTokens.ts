/**
 * useTokens — the normalized token universe for the Tokens list and the Discover
 * rankings. Primary source is the Avnu market list (`GET /swap/v2/tokens`, which
 * carries price / market cap / volume / 24h change per token); if that response
 * shape is missing or empty it falls back to the Ekubo public API (`GET /tokens`
 * enriched with `GET /pairs` volume). Rows are normalized to the app's
 * `TokenRow`; fields a source does not provide are `null`, never invented.
 */
import { useCallback } from "react";
import { getJson } from "./cache";
import { AVNU_BASE, EKUBO_BASE } from "./endpoints";
import type { Resource, TokenRow } from "./types";
import { useAsyncResource } from "./useAsyncResource";

// The token universe (market caps / volumes) drifts slowly; a 2-minute poll is
// ample and keeps the app well under the upstream rate limits.
const POLL_MS = 120_000;
const CACHE_MS = 115_000;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

// ---- Avnu ----

type AvnuMarket = {
  readonly currentPrice?: number;
  readonly marketCap?: number;
  readonly starknetVolume24h?: number;
  readonly volume?: number;
  readonly starknetTradingVolume24h?: number;
  readonly priceChangePercentage24h?: number;
  readonly totalLiquidityInUsd?: number;
};

type AvnuToken = {
  readonly address?: string;
  readonly name?: string;
  readonly symbol?: string;
  readonly decimals?: number;
  readonly logoUri?: string;
  readonly market?: AvnuMarket;
};

type AvnuTokensResponse = readonly AvnuToken[] | { readonly content?: readonly AvnuToken[] };

/** Normalizes the Avnu `/swap/v2/tokens` payload into `TokenRow[]`. Exported so
 * the offline `check:api` script validates the real response with this exact
 * normalizer. */
export const toAvnuRows = (payload: AvnuTokensResponse): readonly TokenRow[] => {
  const list: readonly AvnuToken[] = Array.isArray(payload)
    ? payload
    : ((payload as { readonly content?: readonly AvnuToken[] }).content ?? []);
  const rows: TokenRow[] = [];
  for (const token of list) {
    const address = str(token.address);
    const symbol = str(token.symbol);
    if (address === null || symbol === null) {
      continue;
    }
    const market = token.market ?? {};
    rows.push({
      address,
      name: str(token.name) ?? symbol,
      symbol,
      decimals: typeof token.decimals === "number" ? token.decimals : 18,
      logoUri: str(token.logoUri),
      priceUsd: num(market.currentPrice),
      marketCapUsd: num(market.marketCap),
      volume24hUsd:
        num(market.starknetVolume24h) ??
        num(market.starknetTradingVolume24h) ??
        num(market.volume),
      liquidityUsd: num(market.totalLiquidityInUsd),
      change24h: num(market.priceChangePercentage24h),
    });
  }
  return rows;
};

// ---- Ekubo fallback ----

type EkuboToken = {
  readonly name?: string;
  readonly symbol?: string;
  readonly decimals?: number;
  readonly l2_token_address?: string;
  readonly logo_url?: string;
};

type EkuboPair = {
  readonly token0?: string;
  readonly token1?: string;
  readonly volume0_24h?: string | number;
  readonly volume1_24h?: string | number;
  readonly tvl0_total?: string | number;
  readonly tvl1_total?: string | number;
};

type EkuboTokensResponse = readonly EkuboToken[] | { readonly tokens?: readonly EkuboToken[] };
type EkuboPairsResponse =
  | readonly EkuboPair[]
  | { readonly topPairs?: readonly EkuboPair[]; readonly pairs?: readonly EkuboPair[] };

const toNumberLoose = (value: unknown): number =>
  typeof value === "number"
    ? value
    : typeof value === "string" && value.length > 0
      ? Number(value)
      : 0;

/** Normalizes the Ekubo `/tokens` (+ `/pairs` volume) payloads into `TokenRow[]`.
 * Pure and exported so the offline `check:api` script validates the real
 * responses with this exact normalizer. */
export const toEkuboRows = (
  tokensPayload: EkuboTokensResponse,
  pairsPayload: EkuboPairsResponse,
): readonly TokenRow[] => {
  const tokens: readonly EkuboToken[] = Array.isArray(tokensPayload)
    ? tokensPayload
    : ((tokensPayload as { readonly tokens?: readonly EkuboToken[] }).tokens ?? []);
  const pairs: readonly EkuboPair[] = Array.isArray(pairsPayload)
    ? pairsPayload
    : (() => {
        const obj = pairsPayload as {
          readonly topPairs?: readonly EkuboPair[];
          readonly pairs?: readonly EkuboPair[];
        };
        return obj.topPairs ?? obj.pairs ?? [];
      })();

  // Aggregate 24h volume per token address from the pairs feed.
  const volumeByAddress = new Map<string, number>();
  for (const pair of pairs) {
    const t0 = str(pair.token0);
    const t1 = str(pair.token1);
    if (t0 !== null) {
      volumeByAddress.set(
        t0.toLowerCase(),
        (volumeByAddress.get(t0.toLowerCase()) ?? 0) + toNumberLoose(pair.volume0_24h),
      );
    }
    if (t1 !== null) {
      volumeByAddress.set(
        t1.toLowerCase(),
        (volumeByAddress.get(t1.toLowerCase()) ?? 0) + toNumberLoose(pair.volume1_24h),
      );
    }
  }

  const rows: TokenRow[] = [];
  for (const token of tokens) {
    const address = str(token.l2_token_address);
    const symbol = str(token.symbol);
    if (address === null || symbol === null) {
      continue;
    }
    const volume = volumeByAddress.get(address.toLowerCase());
    rows.push({
      address,
      name: str(token.name) ?? symbol,
      symbol,
      decimals: typeof token.decimals === "number" ? token.decimals : 18,
      logoUri: str(token.logo_url),
      priceUsd: null,
      marketCapUsd: null,
      volume24hUsd: volume !== undefined && volume > 0 ? volume : null,
      liquidityUsd: null,
      change24h: null,
    });
  }
  return rows;
};

const fetchEkuboRows = async (signal: AbortSignal): Promise<readonly TokenRow[]> => {
  const [tokensPayload, pairsPayload] = await Promise.all([
    getJson<EkuboTokensResponse>(`${EKUBO_BASE}/tokens`, { signal, cacheMs: CACHE_MS }),
    getJson<EkuboPairsResponse>(`${EKUBO_BASE}/pairs`, { signal, cacheMs: CACHE_MS }).catch(
      () => [] as EkuboPair[],
    ),
  ]);
  return toEkuboRows(tokensPayload, pairsPayload);
};

const fetchTokens = async (signal: AbortSignal): Promise<readonly TokenRow[]> => {
  try {
    // Fail fast (no retry) so a bad Avnu response falls back to Ekubo quickly.
    const payload = await getJson<AvnuTokensResponse>(`${AVNU_BASE}/swap/v2/tokens`, {
      signal,
      cacheMs: CACHE_MS,
      retries: 0,
    });
    const rows = toAvnuRows(payload);
    if (rows.length > 0) {
      return rows;
    }
  } catch (cause) {
    if (signal.aborted) {
      throw cause;
    }
    // Fall through to the Ekubo fallback below.
  }
  return fetchEkuboRows(signal);
};

/**
 * The normalized token universe, refreshed on the `POLL_MS` cadence.
 */
export const useTokens = (): Resource<readonly TokenRow[]> => {
  const fetcher = useCallback((signal: AbortSignal) => fetchTokens(signal), []);
  return useAsyncResource(fetcher, [], POLL_MS);
};
