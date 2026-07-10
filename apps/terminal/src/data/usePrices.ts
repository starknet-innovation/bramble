/**
 * usePrices — live USD prices + 24h change from CoinGecko, keyed by both
 * lowercased contract address and by symbol. It issues two requests:
 *
 *  - `/simple/token_price/starknet` for the tracked Starknet ERC20 contracts
 *    (plus any extra contract addresses the caller passes), and
 *  - `/simple/price` for the majors by CoinGecko coin id (starknet, ethereum,
 *    usd-coin, tether, dai, wrapped-bitcoin),
 *
 * merging both so a token resolves whether the caller looks it up by address or
 * by symbol. Results poll every 30s. A missing price is surfaced as `null`, not
 * fabricated.
 */
import { useCallback, useMemo } from "react";
import { getJson } from "./cache";
import { coingeckoHeaders, COINGECKO_BASE } from "./endpoints";
import { KNOWN_TOKENS, KNOWN_TOKENS_BY_ADDRESS, SYMBOL_BY_COINGECKO_ID } from "./knownTokens";
import type { PriceEntry, PricesData, Resource } from "./types";
import { useAsyncResource } from "./useAsyncResource";

// Prices move slowly enough that a 60s poll is plenty; a shorter interval only
// burns through CoinGecko's harsh free-tier rate limit (the source of the 429s).
const POLL_MS = 60_000;
// Serve a cached price to any concurrent consumer for just under the poll window
// so Portfolio + Tokens + Discover coalesce into one request per cycle.
const CACHE_MS = 55_000;

/** The per-entry shape CoinGecko returns for both price endpoints. */
export type CoinGeckoPrice = {
  readonly usd?: number;
  readonly usd_24h_change?: number;
};
export type CoinGeckoResponse = Readonly<Record<string, CoinGeckoPrice>>;

/** Normalizes one CoinGecko price row into the app's `PriceEntry`. Exported so
 * the offline `check:api` script validates the real response with this exact
 * parser. */
export const toEntry = (raw: CoinGeckoPrice | undefined): PriceEntry => ({
  usd: typeof raw?.usd === "number" && Number.isFinite(raw.usd) ? raw.usd : null,
  change24h:
    typeof raw?.usd_24h_change === "number" && Number.isFinite(raw.usd_24h_change)
      ? raw.usd_24h_change
      : null,
});

const fetchPrices = async (
  contractAddresses: readonly string[],
  signal: AbortSignal,
): Promise<PricesData> => {
  const ids = KNOWN_TOKENS.map((token) => token.coingeckoId).join(",");
  const tokenUrl =
    `${COINGECKO_BASE}/api/v3/simple/token_price/starknet` +
    `?contract_addresses=${contractAddresses.join(",")}` +
    `&vs_currencies=usd&include_24hr_change=true`;
  const majorsUrl =
    `${COINGECKO_BASE}/api/v3/simple/price` +
    `?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;

  const headers = coingeckoHeaders();
  // Fetch both feeds independently: the two calls have different failure modes
  // (notably, without a CoinGecko API key `token_price` is capped to a single
  // contract address and 400s for the whole tracked set), so one failing feed
  // must not blank the other. The majors `/simple/price` call still resolves the
  // tracked tokens by symbol, and vice-versa. Only if BOTH fail do we surface an
  // error (useAsyncResource then keeps the last-good prices).
  const [tokenSettled, majorSettled] = await Promise.allSettled([
    getJson<CoinGeckoResponse>(tokenUrl, { signal, headers, cacheMs: CACHE_MS }),
    getJson<CoinGeckoResponse>(majorsUrl, { signal, headers, cacheMs: CACHE_MS }),
  ]);
  if (tokenSettled.status === "rejected" && majorSettled.status === "rejected") {
    throw majorSettled.reason;
  }
  const tokenPrices: CoinGeckoResponse =
    tokenSettled.status === "fulfilled" ? tokenSettled.value : {};
  const majorPrices: CoinGeckoResponse =
    majorSettled.status === "fulfilled" ? majorSettled.value : {};

  const byAddress: Record<string, PriceEntry> = {};
  const bySymbol: Record<string, PriceEntry> = {};

  // Contract-price rows are keyed by lowercased address; map to a symbol when
  // the address is one of the tracked tokens.
  for (const [address, raw] of Object.entries(tokenPrices)) {
    const key = address.toLowerCase();
    const entry = toEntry(raw);
    byAddress[key] = entry;
    const known = KNOWN_TOKENS_BY_ADDRESS[key];
    if (known !== undefined) {
      bySymbol[known.symbol] = entry;
    }
  }

  // Majors fill in by symbol, and back-fill any address that the contract call
  // did not return (CoinGecko's Starknet platform coverage is partial).
  for (const [coinId, raw] of Object.entries(majorPrices)) {
    const symbol = SYMBOL_BY_COINGECKO_ID[coinId];
    if (symbol === undefined) {
      continue;
    }
    const entry = toEntry(raw);
    if (bySymbol[symbol] === undefined || bySymbol[symbol]?.usd === null) {
      bySymbol[symbol] = entry;
    }
    const token = KNOWN_TOKENS.find((candidate) => candidate.symbol === symbol);
    if (token !== undefined) {
      const key = token.address.toLowerCase();
      if (byAddress[key] === undefined || byAddress[key]?.usd === null) {
        byAddress[key] = entry;
      }
    }
  }

  return { byAddress, bySymbol };
};

/**
 * Live prices for the tracked tokens plus any extra contract addresses passed
 * in. `inputs` may be addresses or symbols; only 0x-prefixed addresses are added
 * to the contract-price request (symbols already resolve via the majors call).
 */
export const usePrices = (inputs: readonly string[] = []): Resource<PricesData> => {
  const contractAddresses = useMemo(() => {
    const extra = inputs.filter((value) => value.startsWith("0x")).map((value) => value.toLowerCase());
    const base = KNOWN_TOKENS.map((token) => token.address.toLowerCase());
    return Array.from(new Set([...base, ...extra]));
  }, [inputs]);

  const key = contractAddresses.join(",");
  const fetcher = useCallback(
    (signal: AbortSignal) => fetchPrices(contractAddresses, signal),
    [contractAddresses],
  );

  return useAsyncResource<PricesData>(fetcher, [key], POLL_MS);
};
