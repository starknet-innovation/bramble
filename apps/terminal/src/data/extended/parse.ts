/**
 * Pure decoders from Extended's wire format (the `{status,data,error}` REST
 * envelope + the short-key payload aliases) into the readable models in
 * `types.ts`. No I/O — every function takes an already-parsed `unknown` JSON
 * value so it can be unit-tested against mocked payloads. Malformed rows are
 * dropped rather than throwing, except the envelope itself which throws on a
 * declared `ERROR` status so a failed call never reads as empty data.
 */
import { isRecord } from "../../protocols/support/json";
import type {
  ExtendedCandle,
  ExtendedFundingRate,
  ExtendedL2Config,
  ExtendedMarket,
  ExtendedMarketStats,
  ExtendedOrderBook,
  ExtendedOrderBookLevel,
  ExtendedPublicTrade,
  ExtendedTradeSide,
  ExtendedTradingConfig,
  StreamEnvelope,
} from "./types";

/** Coerces a wire number/numeric-string into a finite number, else `fallback`. */
const num = (value: unknown, fallback = 0): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

/** Coerces a wire int/int-string into a safe integer, else `fallback`. */
const int = (value: unknown, fallback = 0): number => Math.trunc(num(value, fallback));

/**
 * Thrown when the REST envelope reports `status: "ERROR"`. Carries the API error
 * message so the data hooks surface it verbatim.
 */
class ExtendedApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtendedApiError";
  }
}

/**
 * Unwraps the common REST envelope. Accepts either the wrapped
 * `{status,data,error}` object or a bare payload (some routes/mirrors may return
 * the payload directly). Throws `ExtendedApiError` when `status === "ERROR"`.
 */
const unwrapEnvelope = (payload: unknown): unknown => {
  if (!isRecord(payload)) {
    return payload;
  }
  if (payload.status === "ERROR") {
    const err = isRecord(payload.error) ? payload.error : null;
    const message =
      err !== null && typeof err.message === "string" ? err.message : "Extended API error";
    throw new ExtendedApiError(message);
  }
  return "data" in payload ? payload.data : payload;
};

// Decodes the MarketStatsModel block (used nested in a market and standalone).
const parseMarketStats = (raw: unknown): ExtendedMarketStats | null => {
  if (!isRecord(raw)) {
    return null;
  }
  return {
    dailyVolume: num(raw.dailyVolume),
    dailyVolumeBase: num(raw.dailyVolumeBase),
    dailyPriceChange: num(raw.dailyPriceChange),
    dailyLow: num(raw.dailyLow),
    dailyHigh: num(raw.dailyHigh),
    lastPrice: num(raw.lastPrice),
    askPrice: num(raw.askPrice),
    bidPrice: num(raw.bidPrice),
    markPrice: num(raw.markPrice),
    indexPrice: num(raw.indexPrice),
    fundingRate: num(raw.fundingRate),
    nextFundingRate: int(raw.nextFundingRate),
    openInterest: num(raw.openInterest),
    openInterestBase: num(raw.openInterestBase),
  };
};

const parseTradingConfig = (raw: unknown): ExtendedTradingConfig | null => {
  if (!isRecord(raw)) {
    return null;
  }
  const risk = Array.isArray(raw.riskFactorConfig)
    ? raw.riskFactorConfig
        .filter(isRecord)
        .map((r) => ({ upperBound: num(r.upperBound), riskFactor: num(r.riskFactor) }))
    : [];
  return {
    minOrderSize: num(raw.minOrderSize),
    minOrderSizeChange: num(raw.minOrderSizeChange),
    minPriceChange: num(raw.minPriceChange),
    maxMarketOrderValue: num(raw.maxMarketOrderValue),
    maxLimitOrderValue: num(raw.maxLimitOrderValue),
    maxPositionValue: num(raw.maxPositionValue),
    maxLeverage: num(raw.maxLeverage),
    maxNumOrders: int(raw.maxNumOrders),
    limitPriceCap: num(raw.limitPriceCap),
    limitPriceFloor: num(raw.limitPriceFloor),
    riskFactorConfig: risk,
  };
};

const parseL2Config = (raw: unknown): ExtendedL2Config | null => {
  if (!isRecord(raw)) {
    return null;
  }
  return {
    type: typeof raw.type === "string" ? raw.type : "",
    collateralId: typeof raw.collateralId === "string" ? raw.collateralId : "",
    collateralResolution: int(raw.collateralResolution),
    syntheticId: typeof raw.syntheticId === "string" ? raw.syntheticId : "",
    syntheticResolution: int(raw.syntheticResolution),
  };
};

// Decodes one MarketModel; returns null when it lacks a usable name.
const parseMarket = (raw: unknown): ExtendedMarket | null => {
  if (!isRecord(raw) || typeof raw.name !== "string" || raw.name.length === 0) {
    return null;
  }
  const tradingConfig = parseTradingConfig(raw.tradingConfig);
  const [derivedBase] = raw.name.split("-");
  return {
    name: raw.name,
    assetName:
      typeof raw.assetName === "string" && raw.assetName.length > 0
        ? raw.assetName
        : (derivedBase ?? raw.name),
    assetPrecision: int(raw.assetPrecision),
    collateralAssetName:
      typeof raw.collateralAssetName === "string" ? raw.collateralAssetName : "USD",
    collateralAssetPrecision: int(raw.collateralAssetPrecision),
    active: raw.active !== false,
    type: typeof raw.type === "string" ? raw.type : null,
    marketStats: parseMarketStats(raw.marketStats),
    tradingConfig,
    l2Config: parseL2Config(raw.l2Config),
    maxLeverage: tradingConfig !== null ? tradingConfig.maxLeverage : num(raw.maxLeverage),
  };
};

/**
 * Parses the `/info/markets` response (envelope-wrapped array of MarketModel)
 * into `ExtendedMarket[]`, dropping malformed rows.
 */
export const parseMarkets = (payload: unknown): readonly ExtendedMarket[] => {
  const data = unwrapEnvelope(payload);
  if (!Array.isArray(data)) {
    return [];
  }
  const out: ExtendedMarket[] = [];
  for (const row of data) {
    const market = parseMarket(row);
    if (market !== null) {
      out.push(market);
    }
  }
  return out;
};

/**
 * Parses the `/info/markets/{market}/stats` response (envelope-wrapped single
 * MarketStatsModel). Some deployments may wrap the single stats object in a
 * length-1 array — both shapes are handled.
 */
export const parseMarketStatsResponse = (payload: unknown): ExtendedMarketStats | null => {
  const data = unwrapEnvelope(payload);
  const record = Array.isArray(data) ? data[0] : data;
  return parseMarketStats(record);
};

/** Decodes one `{o,h,l,c,v?,T}` candle; null when it lacks a timestamp. */
const parseCandle = (raw: unknown): ExtendedCandle | null => {
  if (!isRecord(raw) || (raw.T === undefined && raw.t === undefined)) {
    return null;
  }
  const ms = int(raw.T ?? raw.t);
  return {
    time: Math.floor(ms / 1000),
    open: num(raw.o),
    high: num(raw.h),
    low: num(raw.l),
    close: num(raw.c),
    volume: raw.v === undefined || raw.v === null ? null : num(raw.v),
  };
};

/**
 * Parses a candles payload (REST array or WS `data` array) into ascending-time
 * `ExtendedCandle[]`. The REST endpoint returns descending order; this always
 * re-sorts ascending so the chart renders left-to-right.
 */
export const parseCandles = (payload: unknown): readonly ExtendedCandle[] => {
  const data = unwrapEnvelope(payload);
  if (!Array.isArray(data)) {
    return [];
  }
  const out: ExtendedCandle[] = [];
  for (const row of data) {
    const candle = parseCandle(row);
    if (candle !== null) {
      out.push(candle);
    }
  }
  return out.sort((a, b) => a.time - b.time);
};

/** Decodes one `{m,f,T}` funding record; null when it lacks a market. */
export const parseFundingRate = (raw: unknown): ExtendedFundingRate | null => {
  if (!isRecord(raw)) {
    return null;
  }
  const market =
    typeof raw.m === "string" ? raw.m : typeof raw.market === "string" ? raw.market : "";
  if (market.length === 0) {
    return null;
  }
  return {
    market,
    fundingRate: num(raw.f ?? raw.fundingRate),
    timestamp: int(raw.T ?? raw.timestamp),
  };
};

/**
 * Parses the funding-history response (envelope-wrapped array of `{m,f,T}`) into
 * ascending-time `ExtendedFundingRate[]`.
 */
export const parseFundingHistory = (payload: unknown): readonly ExtendedFundingRate[] => {
  const data = unwrapEnvelope(payload);
  if (!Array.isArray(data)) {
    return [];
  }
  const out: ExtendedFundingRate[] = [];
  for (const row of data) {
    const rate = parseFundingRate(row);
    if (rate !== null) {
      out.push(rate);
    }
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
};

// Decodes an array of `{p,q}` levels, dropping malformed entries.
const parseLevels = (raw: unknown): ExtendedOrderBookLevel[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ExtendedOrderBookLevel[] = [];
  for (const entry of raw) {
    if (isRecord(entry)) {
      out.push({ price: num(entry.p ?? entry.price), qty: num(entry.q ?? entry.qty) });
    }
  }
  return out;
};

/**
 * Decodes an OrderbookUpdateModel — `seq`/`ts` are threaded in from the stream
 * envelope when the caller has them. Accepts every side-key spelling seen in the
 * wild: the short WS aliases (`b`/`a`), the long WS aliases (`bids`/`asks`), and
 * the live REST snapshot's singular `bid`/`ask` keys (`{price,qty}` levels).
 */
export const parseOrderBook = (
  raw: unknown,
  meta?: { readonly seq?: number | null; readonly ts?: number | null },
): ExtendedOrderBook => {
  const record = isRecord(raw) ? raw : {};
  return {
    market:
      typeof record.m === "string"
        ? record.m
        : typeof record.market === "string"
          ? record.market
          : "",
    bids: parseLevels(record.b ?? record.bids ?? record.bid),
    asks: parseLevels(record.a ?? record.asks ?? record.ask),
    seq: meta?.seq ?? null,
    ts: meta?.ts ?? null,
  };
};

/** Parses the REST order-book snapshot response (envelope-wrapped). */
export const parseOrderBookResponse = (payload: unknown): ExtendedOrderBook =>
  parseOrderBook(unwrapEnvelope(payload));

const toTradeSide = (value: unknown): ExtendedTradeSide => (value === "SELL" ? "SELL" : "BUY");

/** Decodes one `{i,m,S,tT,T,p,q}` public trade; null when it lacks an id/price. */
const parsePublicTrade = (raw: unknown): ExtendedPublicTrade | null => {
  if (!isRecord(raw)) {
    return null;
  }
  return {
    id: int(raw.i ?? raw.id),
    market: typeof raw.m === "string" ? raw.m : typeof raw.market === "string" ? raw.market : "",
    side: toTradeSide(raw.S ?? raw.side),
    tradeType:
      typeof raw.tT === "string"
        ? raw.tT
        : typeof raw.tradeType === "string"
          ? raw.tradeType
          : "TRADE",
    timestamp: int(raw.T ?? raw.timestamp),
    price: num(raw.p ?? raw.price),
    qty: num(raw.q ?? raw.qty),
  };
};

/**
 * Parses a public-trades payload (WS `data` is an array of PublicTradeModel;
 * a REST route, if one exists live, would use the same shape) into
 * `ExtendedPublicTrade[]`.
 */
export const parsePublicTrades = (payload: unknown): readonly ExtendedPublicTrade[] => {
  const data = unwrapEnvelope(payload);
  const rows = Array.isArray(data) ? data : [data];
  const out: ExtendedPublicTrade[] = [];
  for (const row of rows) {
    const trade = parsePublicTrade(row);
    if (trade !== null) {
      out.push(trade);
    }
  }
  return out;
};

/**
 * Parses a raw WS frame (string or already-parsed object) into the common
 * `{type,data,error,ts,seq}` envelope. Returns null when the frame is not a JSON
 * object (e.g. a ping/pong or malformed line) so the caller can ignore it.
 */
export const parseStreamMessage = (raw: unknown): StreamEnvelope | null => {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) {
    return null;
  }
  return {
    type: typeof value.type === "string" ? value.type : null,
    data: "data" in value ? value.data : null,
    error: typeof value.error === "string" ? value.error : null,
    ts: value.ts === undefined || value.ts === null ? null : int(value.ts),
    seq: value.seq === undefined || value.seq === null ? null : int(value.seq),
  };
};
