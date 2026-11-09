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
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const wallet = vi.hoisted(() => ({
  value: {
    account: null,
    address: "0x0123456789abcdef",
    chainId: "SN_MAIN",
    walletName: "Bramble",
    isConnected: true,
    isConnecting: false,
    error: null,
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
  },
}));

vi.mock("../../wallet/connection/WalletProvider", () => ({
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
import { fmtSize } from "./perps-data";
import { ORDER_DISABLED_REASON, PERPS_ORDER_PLACEMENT } from "./perps-placement";

// Returns a real `Response` so the production bounded network boundary can read
// its status, headers and streamed body exactly as it would a live upstream.
const respond = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
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
    dailyPriceChange: "1342.5",
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
let holdOrderBook = false;
// Counts frames the screen pushes up a socket; the public streams need none.
const wsSends = { count: 0 };

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
    wsSends.count += 1;
  }
}

const frameFor = (url: string): unknown => {
  if (url.includes("/orderbooks/")) {
    if (holdOrderBook) return null;
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
      if (holdOrderBook) return await new Promise(() => undefined);
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
  holdOrderBook = false;
  wsSends.count = 0;
  vi.restoreAllMocks();
});

describe("Perps screen (live-shaped mocked data)", () => {
  it("keeps small order sizes visible instead of rounding them to zero", () => {
    expect(fmtSize(0.0001)).toBe("0.00010");
  });

  it("renders the market, order book, trade tape and chart from real data", async () => {
    render(<Perps />);

    // Markets list + header from the mocked markets REST.
    expect(await screen.findAllByText("BTC-USD")).not.toHaveLength(0);
    expect(await screen.findAllByText("+2.15%")).not.toHaveLength(0);
    expect(document.querySelector('img[src="/token-assets/extended/BTC.svg"]')).toBeTruthy();

    // Order book populated (the Spread row only renders with a real book).
    expect(await screen.findByText("Spread")).toBeTruthy();
    expect(screen.getByText("Order book")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Order Book" })).toBeNull();
    expect(document.querySelector(".obspread-price")?.textContent).toBe("63,842.5");
    expect(document.querySelector(".orderbook-scroll")?.getAttribute("style")).toBeNull();

    // Public-trades tape populated from the WS TRADE frame -> no empty state.
    await waitFor(() => expect(screen.queryByText("No recent trades")).toBeNull());

    // The live-candle chart path was taken (lightweight-charts createChart run),
    // not the SVG placeholder.
    await waitFor(() => expect(charts.createChart).toHaveBeenCalled());

    const marketHeader = document.querySelector(".tokhead");
    expect(marketHeader?.textContent).toContain("Mark");
    expect(marketHeader?.textContent).toContain("Index");
    expect(marketHeader?.textContent).toContain("24h Change");
    expect(marketHeader?.textContent).toContain("Open Interest");
    expect(marketHeader?.textContent).toContain("Funding");
    expect(marketHeader?.textContent).not.toContain("24h Volume");
    expect(document.querySelector(".chartwrap")?.lastElementChild?.classList).toContain("tfbar");
    expect(document.querySelector(".tradetabs")?.parentElement?.classList).toContain("perpscols");
  });

  it("contains the order-book skeleton while the first snapshot is loading", async () => {
    holdOrderBook = true;
    render(<Perps />);

    await screen.findAllByText("BTC-USD");
    await waitFor(() => expect(document.querySelector(".orderbook-loading")).toBeTruthy());
    expect(document.querySelector(".orderbook-loading")?.closest(".obook")).toBeTruthy();
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

  it("records placement as gated and shows one reason in the banner and the ticket (#69)", async () => {
    expect(PERPS_ORDER_PLACEMENT).toEqual({ reason: ORDER_DISABLED_REASON, status: "gated" });
    render(<Perps />);
    await screen.findAllByText("BTC-USD");

    expect(document.querySelector(".regionbanner")?.textContent).toBe(
      `Market data is live. ${ORDER_DISABLED_REASON}`,
    );
    const note = document.querySelector(".ticket [role='note']");
    expect(note?.textContent).toBe(ORDER_DISABLED_REASON);
    expect(
      screen.getByRole("button", { name: "Order Placement Unavailable" }).getAttribute("title"),
    ).toBe(ORDER_DISABLED_REASON);
  });

  it("disables Deposit and Withdraw behind the placement gate (#69)", async () => {
    render(<Perps />);
    await screen.findAllByText("BTC-USD");

    for (const name of ["Deposit", "Withdraw"]) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.getAttribute("title")).toBe(ORDER_DISABLED_REASON);
    }
  });

  it("sends nothing but public reads however the ticket is used (#69)", async () => {
    render(<Perps />);
    await screen.findAllByText("BTC-USD");
    const ticket = document.querySelector(".ticket");
    expect(ticket).toBeTruthy();

    const amount = ticket?.querySelector("input[inputmode='decimal']");
    if (amount !== null && amount !== undefined) {
      fireEvent.change(amount, { target: { value: "250" } });
    }
    const slider = ticket?.querySelector("input[type='range']");
    if (slider !== null && slider !== undefined) {
      fireEvent.change(slider, { target: { value: "100" } });
    }
    for (const button of Array.from(ticket?.querySelectorAll("button") ?? [])) {
      fireEvent.click(button);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    const calls = vi.mocked(globalThis.fetch).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [input, init] of calls) {
      expect((init?.method ?? "GET").toUpperCase()).toBe("GET");
      expect(init?.body ?? null).toBeNull();
      expect(String(input)).not.toMatch(/\/user\//);
    }
    expect(wsSends.count).toBe(0);
  });

  it("persists followed markets in the Follows tab", async () => {
    render(<Perps />);
    await screen.findAllByText("BTC-USD");

    const followButton = screen.getByRole("button", { name: "Follow" });
    expect(followButton.textContent).toBe("");
    fireEvent.click(followButton);
    expect(screen.getByRole("button", { name: "Following" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Follows" }));
    expect(screen.getByRole("button", { name: /BTC-USD/ })).toBeTruthy();
  });

  it("collapses the market rail without hiding the active trading workspace", async () => {
    render(<Perps />);
    await screen.findAllByText("BTC-USD");

    fireEvent.click(screen.getByRole("button", { name: "Collapse markets" }));
    expect(screen.getByRole("button", { name: "Expand markets" })).toBeTruthy();
    expect(document.querySelector(".perpscols")?.classList).toContain("rail-collapsed");
    expect(screen.getByText("Order book")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Order Placement Unavailable" })).toBeTruthy();
  });
});
