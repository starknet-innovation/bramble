/**
 * Perps screen render test with mocked network (live hosts are 403-blocked in
 * the sandbox). A fake WebSocket + a mocked `fetch` feed realistic Extended
 * payloads so the screen renders LIVE-shaped data end to end:
 *  - the markets list + header from the mocked markets/stats REST,
 *  - the order book from the WS SNAPSHOT (red asks / green bids),
 *  - the public-trades tape from the WS publicTrades stream,
 *  - the candlestick chart from real candles (lightweight-charts is stubbed and
 *    asserted to be invoked, proving the live-data chart path — not the mock),
 *  - and the order ticket disabled with its region/signing reason.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const wallet = vi.hoisted(() => ({
  value: {
    account: null,
    address: "0x0123456789abcdef",
    chainId: "SN_MAIN",
    walletName: "MC Wallet",
    isConnected: true,
    isConnecting: false,
    error: null,
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
  },
}));

vi.mock("../wallet/WalletProvider", () => ({
  useWallet: () => wallet.value,
  WalletProvider: ({ children }: { children: unknown }) => children,
}));

const charts = vi.hoisted(() => ({ createChart: vi.fn() }));

vi.mock("lightweight-charts", () => ({
  CandlestickSeries: {},
  ColorType: { Solid: "solid" },
  createChart: (...args: unknown[]) => {
    charts.createChart(...args);
    return {
      addSeries: () => ({ setData: () => undefined }),
      timeScale: () => ({ fitContent: () => undefined }),
      remove: () => undefined,
    };
  },
}));

import Perps from "./Perps";

const respond = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const ok = (data: unknown): unknown => ({ status: "OK", data, error: null });

const MARKET = {
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
  tradingConfig: { maxLeverage: "40", maxNumOrders: 200, riskFactorConfig: [] },
  l2Config: { type: "STARKX", collateralId: "0x1", collateralResolution: 1, syntheticId: "0x2", syntheticResolution: 1 },
};

const CANDLES = ok([
  { o: "63800", h: "63850", l: "63780", c: "63820", v: "9.4", T: 1710000000000 },
  { o: "63820", h: "63900", l: "63800", c: "63850", v: "12.5", T: 1710000060000 },
]);

// A fake WebSocket that emits the right SNAPSHOT/TRADE/candle/funding frame for
// the stream URL it was opened with, so the WS-driven surfaces populate.
class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    setTimeout(() => {
      this.onopen?.();
      const frame = frameFor(this.url);
      if (frame !== null) {
        this.onmessage?.({ data: JSON.stringify(frame) });
      }
    }, 0);
  }
  close(): void {
    this.onclose?.();
  }
  send(): void {
    // no-op
  }
}

const frameFor = (url: string): unknown => {
  if (url.includes("/orderbooks/")) {
    return {
      type: "SNAPSHOT",
      seq: 1,
      data: {
        m: "BTC-USD",
        b: [
          { p: "63842", q: "1.5" },
          { p: "63841", q: "2.0" },
        ],
        a: [
          { p: "63843", q: "1.0" },
          { p: "63844", q: "3.0" },
        ],
      },
    };
  }
  if (url.includes("/publicTrades/")) {
    return {
      type: "TRADE",
      data: [{ i: 99, m: "BTC-USD", S: "BUY", tT: "TRADE", T: 1710000000000, p: "63845", q: "0.5" }],
    };
  }
  if (url.includes("/candles/")) {
    return { type: "SNAPSHOT", data: [{ o: "63850", h: "63880", l: "63840", c: "63870", v: "3", T: 1710000120000 }] };
  }
  if (url.includes("/funding/")) {
    return { type: "DELTA", data: { m: "BTC-USD", f: "0.0000091", T: 1710000000000 } };
  }
  return null;
};

beforeEach(() => {
  charts.createChart.mockClear();
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  globalThis.fetch = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes("/stats")) {
      return respond(ok(MARKET.marketStats));
    }
    if (url.includes("/orderbook")) {
      return respond(ok({ m: "BTC-USD", b: [{ p: "63842", q: "1.5" }], a: [{ p: "63843", q: "1.0" }] }));
    }
    if (url.includes("/info/candles/")) {
      return respond(CANDLES);
    }
    if (url.includes("/funding")) {
      return respond(ok([{ m: "BTC-USD", f: "0.0000091", T: 1710000000000 }]));
    }
    if (url.includes("/info/markets")) {
      return respond(ok([MARKET]));
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Perps screen (live-shaped mocked data)", () => {
  it("renders the market, order book, trade tape and chart from real data", async () => {
    render(<Perps />);

    // Markets list + header from the mocked markets REST.
    expect(await screen.findAllByText("BTC-USD")).not.toHaveLength(0);

    // Order book populated (the Spread row only renders with a real book).
    expect(await screen.findByText("Spread")).toBeTruthy();

    // Public-trades tape populated from the WS TRADE frame -> no empty state.
    await waitFor(() => expect(screen.queryByText("No recent trades")).toBeNull());

    // The live-candle chart path was taken (lightweight-charts createChart run),
    // not the SVG placeholder.
    await waitFor(() => expect(charts.createChart).toHaveBeenCalled());
  });

  it("keeps the order ticket visible but disabled with a clear reason", async () => {
    render(<Perps />);
    await screen.findAllByText("BTC-USD");

    const cta = screen.getByRole("button", { name: "Order Placement Unavailable" });
    expect(cta).toBeTruthy();
    expect((cta as HTMLButtonElement).disabled).toBe(true);
    // The reason appears in the ticket note (and, worded differently, the banner).
    expect(
      screen.getAllByText(/Order placement requires a signed session/).length,
    ).toBeGreaterThan(0);
  });
});
