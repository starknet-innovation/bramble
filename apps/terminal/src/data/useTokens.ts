/**
 * useTokens — the normalized token universe for the Tokens list and the Discover
 * rankings. Primary source is the AVNU market list (`GET /v3/tokens`, which
 * carries global price history / market cap / volume per token); if that response
 * shape is missing or empty it falls back to the Ekubo public API (`GET /tokens`
 * enriched with `GET /pairs` volume). Rows are normalized to the app's
 * `TokenRow`; fields a source does not provide are `null`, never invented.
 */
import { useCallback } from "react";
import { avnuTokenArtwork } from "../assets/avnu-token-assets";
import { getJson } from "./cache";
import { AVNU_MARKETS_BASE, EKUBO_BASE } from "./endpoints";
import { STARKNET_NETWORKS } from "../protocols/support/networks";
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

type AvnuStarknetMarket = {
  readonly usd?: number;
  readonly usdTvl?: number;
  readonly usdVolume24h?: number;
  readonly usdTradingVolume24h?: number;
  readonly usdPriceChangePercentage24h?: number;
};

type AvnuGlobalMarket = {
  readonly usd?: number;
  readonly usdMarketCap?: number;
  readonly usdMarketCapChangePercentage24h?: number;
};

type AvnuPricePoint = {
  readonly date?: string;
  readonly value?: number;
};

type AvnuToken = {
  readonly address?: string;
  readonly name?: string;
  readonly symbol?: string;
  readonly decimals?: number;
  readonly logoUri?: string;
  readonly starknet?: AvnuStarknetMarket;
  readonly global?: AvnuGlobalMarket | null;
  readonly linePriceFeedInUsd?: readonly AvnuPricePoint[];
  /** Legacy market block accepted so cached/older mirrors fail soft. */
  readonly market?: AvnuMarket;
};

type AvnuTokensResponse = readonly AvnuToken[] | { readonly content?: readonly AvnuToken[] };

const latestLinePrice = (points: readonly AvnuPricePoint[] | undefined): number | null => {
  const latest = points
    ?.flatMap((point) => {
      const at = point.date === undefined ? Number.NaN : Date.parse(point.date);
      const value = num(point.value);
      return Number.isFinite(at) && value !== null && value > 0 ? [{ at, value }] : [];
    })
    .sort((left, right) => left.at - right.at)
    .at(-1);
  return latest?.value ?? null;
};

/**
 * Derives the actual trailing-day price move from AVNU's global USD line feed.
 * This avoids presenting a thin local pool's temporary dislocation as the
 * token's market-wide daily move (most visibly for dollar stablecoins).
 */
export const avnuDailyChange = (
  points: readonly AvnuPricePoint[] | undefined,
): number | null => {
  const rows =
    points
      ?.flatMap((point) => {
        const at = point.date === undefined ? Number.NaN : Date.parse(point.date);
        const value = num(point.value);
        return Number.isFinite(at) && value !== null && value > 0 ? [{ at, value }] : [];
      })
      .sort((left, right) => left.at - right.at) ?? [];
  const latest = rows.at(-1);
  if (latest === undefined) {
    return null;
  }
  const target = latest.at - 86_400_000;
  const previous = rows.reduce<(typeof rows)[number] | null>((closest, row) => {
    if (row.at >= latest.at || latest.at - row.at < 64_800_000) {
      return closest;
    }
    return closest === null || Math.abs(row.at - target) < Math.abs(closest.at - target)
      ? row
      : closest;
  }, null);
  return previous === null ? null : ((latest.value - previous.value) / previous.value) * 100;
};

/** Normalizes the AVNU `/v3/tokens` payload into `TokenRow[]`. Exported so
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
    const starknet = token.starknet ?? {};
    const global = token.global ?? {};
    const globalPrice = num(global.usd) ?? latestLinePrice(token.linePriceFeedInUsd);
    const lineChange = avnuDailyChange(token.linePriceFeedInUsd);
    const globalChange = num(global.usdMarketCapChangePercentage24h);
    const isDollarStable =
      /^(?:USDC(?:\.E)?|USDT|DAI|DAIV0|AUSD\d*|USDU|LUSD|USN|CASH)$/i.test(symbol);
    const reliableStableChange = [lineChange, globalChange].find(
      (change) => change !== null && Math.abs(change) <= 1,
    );
    rows.push({
      address,
      name: str(token.name) ?? symbol,
      symbol,
      decimals: typeof token.decimals === "number" ? token.decimals : 18,
      logoUri: avnuTokenArtwork(address, str(token.logoUri)),
      priceUsd: globalPrice ?? num(starknet.usd) ?? num(market.currentPrice),
      marketCapUsd: num(global.usdMarketCap) ?? num(market.marketCap),
      volume24hUsd:
        num(starknet.usdVolume24h) ??
        num(starknet.usdTradingVolume24h) ??
        num(market.starknetVolume24h) ??
        num(market.starknetTradingVolume24h) ??
        num(market.volume),
      liquidityUsd: num(starknet.usdTvl) ?? num(market.totalLiquidityInUsd),
      change24h:
        (isDollarStable
          ? (reliableStableChange ?? null)
          : (globalChange ??
            lineChange ??
            num(starknet.usdPriceChangePercentage24h) ??
            num(market.priceChangePercentage24h))),
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
  readonly address?: string;
  readonly logo_url?: string;
  readonly usd_price?: number | null;
};

type EkuboTokensResponse = readonly EkuboToken[] | { readonly tokens?: readonly EkuboToken[] };

/** Normalizes the Ekubo `/tokens` payload into `TokenRow[]`.
 * Pure and exported so the offline `check:api` script validates the real
 * responses with this exact normalizer. */
export const toEkuboRows = (tokensPayload: EkuboTokensResponse): readonly TokenRow[] => {
  const tokens: readonly EkuboToken[] = Array.isArray(tokensPayload)
    ? tokensPayload
    : ((tokensPayload as { readonly tokens?: readonly EkuboToken[] }).tokens ?? []);

  const rows: TokenRow[] = [];
  for (const token of tokens) {
    const address = str(token.address) ?? str(token.l2_token_address);
    const symbol = str(token.symbol);
    if (address === null || symbol === null) {
      continue;
    }
    rows.push({
      address,
      name: str(token.name) ?? symbol,
      symbol,
      decimals: typeof token.decimals === "number" ? token.decimals : 18,
      logoUri: str(token.logo_url),
      priceUsd: num(token.usd_price),
      marketCapUsd: null,
      volume24hUsd: null,
      liquidityUsd: null,
      change24h: null,
    });
  }
  return rows;
};

const EKUBO_MAINNET_CHAIN_ID = BigInt(STARKNET_NETWORKS.SN_MAIN.chainId).toString();

const fetchEkuboRows = async (signal: AbortSignal): Promise<readonly TokenRow[]> => {
  const params = new URLSearchParams({ chainId: EKUBO_MAINNET_CHAIN_ID, pageSize: "1000" });
  const tokensPayload = await getJson<EkuboTokensResponse>(`${EKUBO_BASE}/tokens?${params}`, {
    signal,
    cacheMs: CACHE_MS,
  });
  return toEkuboRows(tokensPayload);
};

const fetchTokens = async (signal: AbortSignal): Promise<readonly TokenRow[]> => {
  try {
    // Fail fast (no retry) so a bad Avnu response falls back to Ekubo quickly.
    const payload = await getJson<AvnuTokensResponse>(`${AVNU_MARKETS_BASE}/v3/tokens`, {
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
