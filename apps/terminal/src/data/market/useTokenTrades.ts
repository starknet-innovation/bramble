/**
 * Recent spot fills from Ekubo's indexed pair-events API. The endpoint is the
 * same public indexer surface that powers Ekubo's site. It reports signed pool
 * deltas, so fills are grouped by transaction and normalized relative to the
 * selected token before reaching the Tokens screen.
 */
import { useCallback } from "react";
import { canonicalAddress } from "../../protocols/support/networks";
import { isRecord } from "../../protocols/support/json";
import { getJson } from "../core/cache";
import { EKUBO_BASE } from "../core/endpoints";
import type { Resource, TokenRow, TokenTrade } from "../core/types";
import { useAsyncResource } from "../core/useAsyncResource";

const POLL_MS = 5_000;
const CACHE_MS = 4_000;
const MAX_EVENTS = 500;
const SIGNED_INTEGER = /^-?(?:0|[1-9][0-9]*)$/;
const MAINNET_CHAIN_ID = BigInt("0x534e5f4d41494e").toString();

type PairEvent = {
  readonly timestampMs: number;
  readonly txHash: string;
  readonly trader: string;
  readonly selectedDelta: bigint;
  readonly quoteDelta: bigint;
};

const decimal = (value: unknown): bigint | null => {
  if (typeof value !== "string" || value.length > 256 || !SIGNED_INTEGER.test(value)) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

const felt = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length > 80) {
    return null;
  }
  try {
    const hex = value.startsWith("0x") ? value : `0x${BigInt(value).toString(16)}`;
    return canonicalAddress(hex);
  } catch {
    return null;
  }
};

const tokenAmount = (raw: bigint, decimals: number): number => {
  const negative = raw < 0n;
  const digits = (negative ? -raw : raw).toString().padStart(decimals + 1, "0");
  const integer = digits.slice(0, digits.length - decimals);
  const fraction = decimals === 0 ? "" : digits.slice(digits.length - decimals);
  const amount = Number(`${negative ? "-" : ""}${integer}${fraction === "" ? "" : `.${fraction}`}`);
  return Number.isFinite(amount) ? amount : Number.NaN;
};

const sameToken = (left: TokenRow, right: TokenRow): boolean =>
  canonicalAddress(left.address) !== null &&
  canonicalAddress(left.address) === canonicalAddress(right.address);

const parsePairEvent = (value: unknown, selected: TokenRow, quote: TokenRow): PairEvent | null => {
  if (!isRecord(value) || value["type"] !== 0) {
    return null;
  }
  const delta0 = decimal(value["delta0"]);
  const delta1 = decimal(value["delta1"]);
  const txHash = felt(value["transaction_hash"]);
  const trader = felt(value["locker"]);
  const timestampMs =
    typeof value["timestamp"] === "string" ? Date.parse(value["timestamp"]) : Number.NaN;
  if (
    delta0 === null ||
    delta1 === null ||
    txHash === null ||
    trader === null ||
    !Number.isSafeInteger(timestampMs) ||
    timestampMs < 0
  ) {
    return null;
  }
  let selectedIsToken0: boolean;
  try {
    selectedIsToken0 = BigInt(selected.address) < BigInt(quote.address);
  } catch {
    return null;
  }
  return {
    timestampMs,
    txHash,
    trader,
    selectedDelta: selectedIsToken0 ? delta0 : delta1,
    quoteDelta: selectedIsToken0 ? delta1 : delta0,
  };
};

/**
 * Parses and transaction-aggregates Ekubo pair events. A valid trade must move
 * the selected and quote assets in opposite directions; liquidity events and
 * malformed/zero deltas are excluded.
 */
export const parseEkuboTokenTrades = (
  value: unknown,
  selected: TokenRow,
  quote: TokenRow,
): readonly TokenTrade[] => {
  if (!isRecord(value) || !Array.isArray(value["data"]) || value["data"].length > MAX_EVENTS) {
    throw new Error("Ekubo returned invalid pair events");
  }
  const grouped = new Map<string, PairEvent>();
  for (const raw of value["data"]) {
    const event = parsePairEvent(raw, selected, quote);
    if (event === null) continue;
    const prior = grouped.get(event.txHash);
    grouped.set(
      event.txHash,
      prior === undefined
        ? event
        : {
            ...event,
            timestampMs: Math.max(prior.timestampMs, event.timestampMs),
            selectedDelta: prior.selectedDelta + event.selectedDelta,
            quoteDelta: prior.quoteDelta + event.quoteDelta,
          },
    );
  }
  return [...grouped.values()]
    .flatMap((event): readonly TokenTrade[] => {
      if (
        event.selectedDelta === 0n ||
        event.quoteDelta === 0n ||
        event.selectedDelta < 0n === event.quoteDelta < 0n
      ) {
        return [];
      }
      const amount = Math.abs(tokenAmount(event.selectedDelta, selected.decimals));
      const quoteAmount = Math.abs(tokenAmount(event.quoteDelta, quote.decimals));
      const quotePrice = quote.priceUsd;
      if (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        !Number.isFinite(quoteAmount) ||
        quoteAmount <= 0 ||
        quotePrice === null ||
        !Number.isFinite(quotePrice) ||
        quotePrice <= 0
      ) {
        return [];
      }
      const valueUsd = quoteAmount * quotePrice;
      const priceUsd = valueUsd / amount;
      return Number.isFinite(priceUsd) && priceUsd > 0
        ? [
            {
              amount,
              id: `ekubo:${event.txHash}`,
              priceUsd,
              quoteSymbol: quote.symbol,
              side: event.selectedDelta < 0n ? "buy" : "sell",
              timestampMs: event.timestampMs,
              trader: event.trader,
              txHash: event.txHash,
              valueUsd,
            },
          ]
        : [];
    })
    .sort((left, right) => right.timestampMs - left.timestampMs);
};

const quoteCandidates = (selected: TokenRow, tokens: readonly TokenRow[]): readonly TokenRow[] => {
  const rank = (token: TokenRow): number => {
    const symbol = token.symbol.toUpperCase();
    const bridged = /BRIDGED/i.test(token.name) || symbol === "USDC.E";
    if (symbol === "USDC" && !bridged) return 0;
    if (symbol === "USDC.E" || (symbol === "USDC" && bridged)) return 1;
    if (symbol === "ETH") return 2;
    if (symbol === "USDT") return 3;
    return 10;
  };
  return tokens
    .filter(
      (token) =>
        !sameToken(token, selected) &&
        token.priceUsd !== null &&
        token.priceUsd > 0 &&
        rank(token) < 10,
    )
    .sort((left, right) => rank(left) - rank(right));
};

/** Fetches the first liquid preferred quote pair for one selected token. */
const fetchTokenTrades = async (
  selected: TokenRow,
  tokens: readonly TokenRow[],
  signal: AbortSignal,
): Promise<readonly TokenTrade[]> => {
  let firstError: unknown = null;
  let reachedPair = false;
  for (const quote of quoteCandidates(selected, tokens)) {
    const url = `${EKUBO_BASE}/tokens/${MAINNET_CHAIN_ID}/${encodeURIComponent(selected.address)}/${encodeURIComponent(quote.address)}/events`;
    try {
      const payload = await getJson<unknown>(url, { signal, cacheMs: CACHE_MS, retries: 0 });
      reachedPair = true;
      const trades = parseEkuboTokenTrades(payload, selected, quote);
      if (trades.length > 0) {
        return trades;
      }
    } catch (cause) {
      if (signal.aborted) throw cause;
      firstError ??= cause;
    }
  }
  if (!reachedPair && firstError !== null) {
    throw firstError;
  }
  return [];
};

/** Polls recent verified spot fills for the selected token. */
export const useTokenTrades = (
  selected: TokenRow | null,
  tokens: readonly TokenRow[],
): Resource<readonly TokenTrade[]> => {
  const candidatesKey = tokens.map((token) => `${token.address}:${token.priceUsd ?? ""}`).join(",");
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      selected === null ? Promise.resolve([]) : fetchTokenTrades(selected, tokens, signal),
    [selected, tokens],
  );
  return useAsyncResource(fetcher, [selected?.address ?? "", candidatesKey], POLL_MS);
};
