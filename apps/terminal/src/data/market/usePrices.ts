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

const fetchPrices = async (signal?: AbortSignal): Promise<PricesData> => {
  const payload = await getJson<Parameters<typeof toAvnuRows>[0]>(
    `${AVNU_MARKETS_BASE}/v3/tokens`,
    { signal, cacheMs: CACHE_MS },
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

/**
 * One token's USD price from the same AVNU feed, keyed by contract address, as
 * an independent reference for checks on another venue's quote (the Vesu
 * Multiply swap cap, #646). Resolves null, never throws, when the feed fails or
 * has no positive finite price, so the caller can refuse rather than guess.
 */
export const referenceUsdPrice = async (asset: string): Promise<number | null> => {
  try {
    const { byAddress } = await fetchPrices();
    const usd = byAddress[canonicalAddress(asset) ?? asset.toLowerCase()]?.usd ?? null;
    return usd !== null && Number.isFinite(usd) && usd > 0 ? usd : null;
  } catch {
    return null;
  }
};

/** Live AVNU market prices. `inputs` is retained as a refresh dependency for callers. */
export const usePrices = (inputs: readonly string[] = []): Resource<PricesData> => {
  const key = inputs.join(",");
  const fetcher = useCallback((signal: AbortSignal) => fetchPrices(signal), []);
  return useAsyncResource(fetcher, [key], POLL_MS);
};
