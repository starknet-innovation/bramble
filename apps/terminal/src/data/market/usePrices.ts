/**
 * Live USD prices and 24h changes from AVNU's supported market-data API. The
 * response is keyed by contract address only: a symbol is self-declared by the
 * token, so it cannot identify a price (Sherlock 194). It shares the exact request/cache entry used by useTokens.
 */
import { useCallback } from "react";
import { canonicalAddress } from "../../protocols/support/networks";
import { getJson } from "../core/cache";
import { AVNU_MARKETS_BASE } from "../core/endpoints";
import type { PriceEntry, PricesData, Resource } from "../core/types";
import { useAsyncResource } from "../core/useAsyncResource";
import { toAvnuRows } from "./useTokens";

const POLL_MS = 60_000;
const CACHE_MS = 55_000;

const fetchPrices = async (signal?: AbortSignal, cacheMs = CACHE_MS): Promise<PricesData> => {
  const payload = await getJson<Parameters<typeof toAvnuRows>[0]>(
    `${AVNU_MARKETS_BASE}/v3/tokens`,
    { signal, cacheMs },
  );
  const rows = toAvnuRows(payload);
  if (rows.length === 0) {
    throw new Error("AVNU returned no market data");
  }

  const byAddress: Record<string, PriceEntry> = {};
  for (const row of rows) {
    const entry: PriceEntry = { usd: row.priceUsd, change24h: row.change24h };
    byAddress[canonicalAddress(row.address) ?? row.address.toLowerCase()] = entry;
  }
  return { byAddress };
};

const readReferencePrice = async (asset: string, cacheMs: number): Promise<number | null> => {
  try {
    const { byAddress } = await fetchPrices(undefined, cacheMs);
    const usd = byAddress[canonicalAddress(asset) ?? asset.toLowerCase()]?.usd ?? null;
    return usd !== null && Number.isFinite(usd) && usd > 0 ? usd : null;
  } catch {
    return null;
  }
};

/**
 * One token's USD price from the same AVNU feed, keyed by contract address, as
 * an independent reference for checks on another venue's quote (the Vesu
 * Multiply swap cap, #646). May serve the feed's shared 55s cache. Resolves
 * null, never throws, when the feed fails or has no positive finite price, so
 * the caller can refuse rather than guess.
 */
export const referenceUsdPrice = (asset: string): Promise<number | null> =>
  readReferencePrice(asset, CACHE_MS);

/**
 * {@link referenceUsdPrice} read past the cache, for the re-check right before
 * wallet handoff: the price the quote was checked against must not be reused.
 * Resolves null (so the caller refuses) when no fresh price can be read.
 */
export const freshReferenceUsdPrice = (asset: string): Promise<number | null> =>
  readReferencePrice(asset, 0);

/** Live AVNU market prices. `inputs` is retained as a refresh dependency for callers. */
export const usePrices = (inputs: readonly string[] = []): Resource<PricesData> => {
  const key = inputs.join(",");
  const fetcher = useCallback((signal: AbortSignal) => fetchPrices(signal), []);
  return useAsyncResource(fetcher, [key], POLL_MS);
};
