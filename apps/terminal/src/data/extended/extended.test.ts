/**
 * Extended data-layer tests (mocked — the live hosts are 403-blocked from the
 * sandbox). Covers: (a) parsing a realistic envelope-wrapped payload for EACH
 * public REST endpoint into the typed models, exercised through the REST client
 * with a mocked `fetch`; and (b) the WS order-book aggregator applying a
 * SNAPSHOT then DELTA sequence (with seq ordering + qty-0 removal) plus the
 * stream-envelope parser and `connectStream` wiring via a fake WebSocket.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeBridgeStatus } from "./bridge-protocol";
import {
  fetchCandles,
  fetchFundingHistory,
  fetchMarketStats,
  fetchMarkets,
  fetchOrderBook,
} from "./rest";
import {
  parsePublicTrades,
  parseStreamMessage,
} from "./parse";
import { connectStream, createOrderBookAggregator } from "./ws";
import type { StreamEnvelope } from "./types";

// Returns a real `Response` so the production bounded network boundary can read
// its status, headers and streamed body exactly as it would a live upstream.
const respond = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });

const ok = (data: unknown): unknown => ({ status: "OK", data, error: null });

// Realistic mocked payloads mirroring the catalog's field-level shapes.
const MARKETS = ok([
  {
    name: "BTC-USD",
    assetName: "BTC",
    assetPrecision: 5,
    collateralAssetName: "USD",
    collateralAssetPrecision: 6,
    active: true,
    type: "PERPETUAL",
    marketStats: {
      dailyVolume: "1280000000",
      dailyVolumeBase: "20000",
      dailyPriceChange: "0.0214",
      dailyLow: "62000",
      dailyHigh: "64000",
      lastPrice: "63842.5",
      askPrice: "63843",
      bidPrice: "63842",
      markPrice: "63842.5",
      indexPrice: "63830.1",
      fundingRate: "0.0000091",
      nextFundingRate: 1710000000000,
      openInterest: "418600000",
      openInterestBase: "6500",
    },
    tradingConfig: {
      minOrderSize: "0.0001",
      minOrderSizeChange: "0.0001",
      minPriceChange: "0.1",
      maxMarketOrderValue: "1000000",
      maxLimitOrderValue: "5000000",
      maxPositionValue: "10000000",
      maxLeverage: "40",
      maxNumOrders: 200,
      limitPriceCap: "0.05",
      limitPriceFloor: "0.05",
      riskFactorConfig: [{ upperBound: "100000", riskFactor: "0.02" }],
    },
    l2Config: {
      type: "STARKX",
      collateralId: "0x1",
      collateralResolution: 1000000,
      syntheticId: "0x2",
      syntheticResolution: 10000000,
    },
  },
]);

const STATS = ok({
  dailyVolume: "842100000",
  dailyVolumeBase: "12000",
  dailyPriceChange: "0.018",
  dailyLow: "3200",
  dailyHigh: "3350",
  lastPrice: "3284.1",
  askPrice: "3284.2",
  bidPrice: "3284.0",
  markPrice: "3284.1",
  indexPrice: "3283.4",
  fundingRate: "0.0000072",
  nextFundingRate: 1710000000000,
  openInterest: "212400000",
  openInterestBase: "3000",
});

// Candles arrive descending; the parser must return ascending.
const CANDLES = ok([
  { o: "63840", h: "63900", l: "63800", c: "63850", v: "12.5", T: 1710000120000 },
  { o: "63820", h: "63860", l: "63790", c: "63840", v: "10.1", T: 1710000060000 },
  { o: "63800", h: "63850", l: "63780", c: "63820", v: "9.4", T: 1710000000000 },
]);

const FUNDING = ok([
  { m: "BTC-USD", f: "0.0000091", T: 1710000000000 },
  { m: "BTC-USD", f: "0.0000088", T: 1709996400000 },
]);

const ORDERBOOK = ok({
  m: "BTC-USD",
  b: [
    { p: "63842", q: "1.5" },
    { p: "63841", q: "2.0" },
  ],
  a: [
    { p: "63843", q: "1.0" },
    { p: "63844", q: "3.0" },
  ],
});

const routeFetch = (): void => {
  globalThis.fetch = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes("/stats")) {
      return respond(STATS);
    }
    if (url.includes("/orderbook")) {
      return respond(ORDERBOOK);
    }
    if (url.includes("/info/candles/")) {
      return respond(CANDLES);
    }
    if (url.includes("/funding")) {
      return respond(FUNDING);
    }
    if (url.includes("/info/markets")) {
      return respond(MARKETS);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Extended REST client (mocked payloads, one per endpoint)", () => {
  it("#1 GET /info/markets -> ExtendedMarket[] with decoded nested stats/config", async () => {
    routeFetch();
    const markets = await fetchMarkets();
    expect(markets).toHaveLength(1);
    const btc = markets[0]!;
    expect(btc.name).toBe("BTC-USD");
    expect(btc.type).toBe("PERPETUAL");
    expect(btc.maxLeverage).toBe(40);
    expect(btc.marketStats?.lastPrice).toBe(63842.5);
    expect(btc.marketStats?.openInterest).toBe(418600000);
    expect(btc.tradingConfig?.maxNumOrders).toBe(200);
    expect(btc.tradingConfig?.riskFactorConfig[0]).toEqual({
      upperBound: 100000,
      riskFactor: 0.02,
    });
    expect(btc.l2Config?.syntheticResolution).toBe(10000000);
  });

  it("#2 GET /info/markets/{market}/stats -> ExtendedMarketStats", async () => {
    routeFetch();
    const stats = await fetchMarketStats("ETH-USD");
    expect(stats).not.toBeNull();
    expect(stats?.markPrice).toBe(3284.1);
    expect(stats?.indexPrice).toBe(3283.4);
    expect(stats?.fundingRate).toBeCloseTo(0.0000072, 10);
    expect(stats?.openInterest).toBe(212400000);
    expect(stats?.nextFundingRate).toBe(1710000000000);
  });

  it("#3 GET /info/candles/{market}/{candleType} -> ascending ExtendedCandle[]", async () => {
    routeFetch();
    const candles = await fetchCandles("BTC-USD", "trades", "PT1M");
    expect(candles).toHaveLength(3);
    // Short keys decoded; time converted ms -> s; re-sorted ascending.
    expect(candles[0]!.time).toBe(1710000000);
    expect(candles[0]!.open).toBe(63800);
    expect(candles[2]!.close).toBe(63850);
    for (let i = 1; i < candles.length; i += 1) {
      expect(candles[i]!.time).toBeGreaterThan(candles[i - 1]!.time);
    }
  });

  it("#4 GET /info/{market}/funding -> ascending ExtendedFundingRate[]", async () => {
    routeFetch();
    const history = await fetchFundingHistory("BTC-USD", 0, Date.now());
    expect(history).toHaveLength(2);
    expect(history[0]!.timestamp).toBeLessThan(history[1]!.timestamp);
    expect(history[1]!.market).toBe("BTC-USD");
    expect(history[1]!.fundingRate).toBeCloseTo(0.0000091, 10);
  });

  it("#5 GET /info/markets/{market}/orderbook -> ExtendedOrderBook", async () => {
    routeFetch();
    const book = await fetchOrderBook("BTC-USD");
    expect(book.market).toBe("BTC-USD");
    expect(book.bids).toEqual([
      { price: 63842, qty: 1.5 },
      { price: 63841, qty: 2 },
    ]);
    expect(book.asks[0]).toEqual({ price: 63843, qty: 1 });
  });
});

describe("Public trades parsing (WS-sourced; no confirmed REST route)", () => {
  it("decodes {i,m,S,tT,T,p,q} short keys", () => {
    const trades = parsePublicTrades([
      { i: 12, m: "BTC-USD", S: "SELL", tT: "TRADE", T: 1710000000000, p: "63842", q: "0.25" },
    ]);
    expect(trades[0]).toEqual({
      id: 12,
      market: "BTC-USD",
      side: "SELL",
      tradeType: "TRADE",
      timestamp: 1710000000000,
      price: 63842,
      qty: 0.25,
    });
  });
});

describe("WS envelope + order-book aggregator (SNAPSHOT then DELTA)", () => {
  it("parses the {type,data,error,ts,seq} envelope", () => {
    const env = parseStreamMessage(
      JSON.stringify({ type: "DELTA", data: { m: "BTC-USD" }, ts: 5, seq: 9 }),
    );
    expect(env).toMatchObject({ type: "DELTA", ts: 5, seq: 9 });
  });

  it("applies a SNAPSHOT then a DELTA, respecting seq and removing q=0 levels", () => {
    const agg = createOrderBookAggregator("BTC-USD");
    const snapshot: StreamEnvelope = {
      type: "SNAPSHOT",
      data: {
        m: "BTC-USD",
        b: [
          { p: 100, q: 2 },
          { p: 99, q: 3 },
        ],
        a: [
          { p: 101, q: 1 },
          { p: 102, q: 4 },
        ],
      },
      error: null,
      ts: 1,
      seq: 1,
    };
    agg.apply(snapshot);
    expect(agg.hasData()).toBe(true);

    const delta: StreamEnvelope = {
      type: "DELTA",
      data: {
        m: "BTC-USD",
        b: [{ p: 100, q: 0 }], // remove bid 100
        a: [
          { p: 101, q: 5 }, // update ask 101
          { p: 103, q: 2 }, // add ask 103
        ],
      },
      error: null,
      ts: 2,
      seq: 2,
    };
    agg.apply(delta);

    const book = agg.snapshot();
    expect(book.bids).toEqual([{ price: 99, qty: 3 }]);
    expect(book.asks).toEqual([
      { price: 101, qty: 5 },
      { price: 102, qty: 4 },
      { price: 103, qty: 2 },
    ]);
    expect(book.seq).toBe(2);

    // A stale delta (seq <= last) is ignored.
    agg.apply({ ...delta, data: { m: "BTC-USD", b: [{ p: 99, q: 0 }], a: [] }, seq: 1 });
    expect(agg.snapshot().bids).toEqual([{ price: 99, qty: 3 }]);
  });
});

describe("connectStream (fake WebSocket)", () => {
  it("does not open a socket when closed during a Strict Mode mount cycle", async () => {
    let constructed = 0;
    class FakeWs {
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor() {
        constructed += 1;
      }
      close(): void {
        this.onclose?.();
      }
    }

    const handle = connectStream({
      url: "wss://example/orderbooks/BTC-USD",
      WebSocketCtor: FakeWs as unknown as typeof WebSocket,
      onMessage: () => undefined,
    });
    handle.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(constructed).toBe(0);
  });

  it("delivers parsed envelopes and closes cleanly", async () => {
    const received: StreamEnvelope[] = [];
    let opened = false;

    class FakeWs {
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor(public url: string) {
        setTimeout(() => {
          opened = true;
          this.onopen?.();
          this.onmessage?.({
            data: JSON.stringify({ type: "TRADE", data: [{ i: 1, m: "BTC-USD", p: "1" }], seq: 7 }),
          });
        }, 0);
      }
      close(): void {
        this.onclose?.();
      }
    }

    const handle = connectStream({
      url: "wss://example/orderbooks/BTC-USD",
      WebSocketCtor: FakeWs as unknown as typeof WebSocket,
      onMessage: (env) => received.push(env),
    });

    await vi.waitFor(() => expect(received.length).toBeGreaterThan(0));
    expect(opened).toBe(true);
    expect(received[0]).toMatchObject({ type: "TRADE", seq: 7 });
    handle.close();
  });

  it("uses managed bridge frames as connection status, not market data", async () => {
    const received: StreamEnvelope[] = [];
    const statuses: string[] = [];

    class FakeWs {
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor() {
        setTimeout(() => {
          this.onopen?.();
          this.onmessage?.({ data: encodeBridgeStatus("open") });
          this.onmessage?.({
            data: JSON.stringify({ type: "TRADE", data: [{ i: 1 }], seq: 1 }),
          });
        }, 0);
      }
      close(): void {
        this.onclose?.();
      }
    }

    const handle = connectStream({
      url: "ws://localhost:5273/proxy/extended-ws/stream.extended.exchange/v1/publicTrades/BTC-USD",
      WebSocketCtor: FakeWs as unknown as typeof WebSocket,
      onMessage: (envelope) => received.push(envelope),
      onStatus: (status) => statuses.push(status),
    });

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(statuses.at(-1)).toBe("open");
    expect(received[0]).toMatchObject({ type: "TRADE", seq: 1 });
    handle.close();
  });
});
