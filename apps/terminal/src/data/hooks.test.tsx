/**
 * Data-layer hook tests. The live hosts (AVNU / Ekubo) and the Starknet RPC
 * are unreachable from the sandbox (403), so these mock `fetch` with realistic
 * sample payloads and stub the shared `withRpc` accessor with a fake provider,
 * then assert each hook parses the response into the app types. This is the
 * verification that the parsing + wiring are correct despite no live egress.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAINNET_TOKEN_ADDRESSES } from "../protocols";

// Shared, hoisted balance table the stubbed RPC provider reads from.
const rpc = vi.hoisted(() => ({ balances: new Map<string, bigint>() }));

vi.mock("./client", async () => {
  const actual = await vi.importActual<typeof import("./client")>("./client");
  return {
    ...actual,
    withRpc: <T,>(run: (provider: unknown) => Promise<T>): Promise<T> =>
      run({
        callContract: async ({ contractAddress }: { contractAddress: string }) => {
          const raw = rpc.balances.get(contractAddress.toLowerCase()) ?? 0n;
          const mask = (1n << 128n) - 1n;
          return [`0x${(raw & mask).toString(16)}`, `0x${(raw >> 128n).toString(16)}`];
        },
      }),
  };
});

import { useBalances } from "./useBalances";
import { useCandles } from "./useCandles";
import { usePortfolio } from "./usePortfolio";
import { usePrices } from "./usePrices";
import { useTokens } from "./useTokens";
import { useAsyncResource } from "./useAsyncResource";

const ETH = MAINNET_TOKEN_ADDRESSES.ETH;
const USDC = MAINNET_TOKEN_ADDRESSES.USDC;
const STRK = MAINNET_TOKEN_ADDRESSES.STRK;

type FakeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

const respond = (body: unknown, status = 200): FakeResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const AVNU_TOKENS = [
  {
    address: "0xabc",
    name: "Ekubo",
    symbol: "EKUBO",
    decimals: 18,
    logoUri: "https://logos/ekubo.png",
    market: {
      currentPrice: 2.18,
      marketCap: 142_600_000,
      starknetVolume24h: 412_000,
      priceChangePercentage24h: -3.4,
      totalLiquidityInUsd: 18_400_000,
    },
  },
  {
    address: ETH,
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
    starknet: { usd: 3000, usdPriceChangePercentage24h: 2, usdTvl: 10_000_000 },
    global: { usd: 3000, usdMarketCap: 300_000_000_000 },
  },
  {
    address: USDC,
    name: "USD Coin",
    symbol: "USDC",
    decimals: 6,
    starknet: { usd: 1, usdPriceChangePercentage24h: 0, usdTvl: 5_000_000 },
    global: { usd: 1, usdMarketCap: 50_000_000_000 },
  },
  {
    address: STRK,
    name: "Starknet Token",
    symbol: "STRK",
    decimals: 18,
    starknet: { usd: 0.14, usdPriceChangePercentage24h: 6, usdTvl: 4_000_000 },
    global: { usd: 0.14, usdMarketCap: 500_000_000 },
  },
];

const AVNU_CANDLES = [
  { date: "2026-07-09T00:00:00Z", open: 100, high: 112, low: 98, close: 110 },
  { date: "2026-07-09T01:00:00Z", open: 110, high: 121, low: 109, close: 120 },
];

// Routes a fetch by URL substring to the matching sample payload.
const routeFetch = (avnuStatus = 200): void => {
  globalThis.fetch = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes("/prices/candle")) {
      return respond(AVNU_CANDLES);
    }
    if (url.includes("avnu.fi")) {
      return respond(avnuStatus === 200 ? AVNU_TOKENS : { error: "boom" }, avnuStatus);
    }
    if (url.includes("ekubo.org") && url.includes("/tokens")) {
      return respond([
        { name: "Nostra", symbol: "NSTR", decimals: 18, l2_token_address: "0xdef", logo_url: "u" },
      ]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
};

beforeEach(() => {
  rpc.balances = new Map<string, bigint>([
    [ETH.toLowerCase(), 1_000_000_000_000_000_000n], // 1 ETH
    [USDC.toLowerCase(), 500_000_000n], // 500 USDC
    [STRK.toLowerCase(), 0n],
  ]);
  routeFetch(200);
});

describe("useTokens", () => {
  it("normalizes the Avnu market list into TokenRows", async () => {
    const { result } = renderHook(() => useTokens());
    await waitFor(() => expect(result.current.data).not.toBeNull());
    const rows = result.current.data ?? [];
    expect(rows).toHaveLength(4);
    expect(rows.find((row) => row.symbol === "EKUBO")).toMatchObject({
      address: "0xabc",
      symbol: "EKUBO",
      priceUsd: 2.18,
      marketCapUsd: 142_600_000,
      volume24hUsd: 412_000,
      liquidityUsd: 18_400_000,
      change24h: -3.4,
      logoUri: "https://logos/ekubo.png",
    });
  });

  it("falls back to Ekubo when the Avnu response is not ok", async () => {
    routeFetch(500);
    const { result } = renderHook(() => useTokens());
    await waitFor(() => expect(result.current.data).not.toBeNull());
    const rows = result.current.data ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      symbol: "NSTR",
      address: "0xdef",
      priceUsd: null,
      volume24hUsd: null,
    });
  });
});

describe("usePrices", () => {
  it("keys prices by lowercased address and by symbol", async () => {
    const { result } = renderHook(() => usePrices());
    await waitFor(() => expect(result.current.data).not.toBeNull());
    const data = result.current.data;
    expect(data?.byAddress[ETH.toLowerCase()]).toEqual({ usd: 3000, change24h: 2 });
    expect(data?.bySymbol.ETH).toEqual({ usd: 3000, change24h: 2 });
    expect(data?.bySymbol.STRK?.usd).toBe(0.14);
  });
});

describe("useBalances", () => {
  it("decodes u256 balanceOf results with per-token decimals", async () => {
    const { result } = renderHook(() => useBalances(ETH));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    const rows = result.current.data ?? [];
    const eth = rows.find((row) => row.symbol === "ETH");
    const usdc = rows.find((row) => row.symbol === "USDC");
    expect(eth?.display).toBe("1");
    expect(eth?.amount).toBe(1);
    expect(usdc?.amount).toBe(500);
  });

  it("returns an empty list with no address", async () => {
    const { result } = renderHook(() => useBalances(null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual([]);
  });
});

describe("usePortfolio", () => {
  it("composes balances + prices into priced holdings and totals", async () => {
    const { result } = renderHook(() => usePortfolio(ETH));
    await waitFor(() => expect(result.current.data.holdings.length).toBeGreaterThan(0));
    const { holdings, totalValueUsd } = result.current.data;
    // ETH (1 * 3000) + USDC (500 * 1) = 3500; STRK has zero balance -> excluded.
    expect(holdings.map((h) => h.symbol).sort()).toEqual(["ETH", "USDC"]);
    expect(totalValueUsd).toBeCloseTo(3500, 5);
    const eth = holdings.find((h) => h.symbol === "ETH");
    expect(eth?.usdValue).toBeCloseTo(3000, 5);
  });
});

describe("useCandles", () => {
  it("normalizes AVNU OHLC candles", async () => {
    const { result } = renderHook(() => useCandles(ETH, "1d"));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    const candles = result.current.data ?? [];
    expect(candles.length).toBeGreaterThan(0);
    expect(candles[0]).toMatchObject({ open: 100 });
    for (let i = 1; i < candles.length; i += 1) {
      expect(candles[i]!.time).toBeGreaterThan(candles[i - 1]!.time);
    }
  });
});

describe("useAsyncResource", () => {
  it("clears data immediately when the resource identity changes", async () => {
    const { result, rerender } = renderHook(
      ({ identity }: { readonly identity: string }) =>
        useAsyncResource(
          (signal) =>
            identity === "first"
              ? Promise.resolve("first-data")
              : new Promise<string>((_resolve, reject) => {
                  signal.addEventListener("abort", () => reject(signal.reason), { once: true });
                }),
          [identity],
        ),
      { initialProps: { identity: "first" } },
    );
    await waitFor(() => expect(result.current.data).toBe("first-data"));

    rerender({ identity: "second" });
    await waitFor(() => expect(result.current.data).toBeNull());
    expect(result.current.isLoading).toBe(true);
  });
});
