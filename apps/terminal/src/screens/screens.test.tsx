/**
 * Screen render tests with mocked network. The wallet, `fetch`, the RPC provider
 * (via the shared `withRpc`), and lightweight-charts are all stubbed so the
 * screens can be rendered in jsdom. These assert that:
 *  - Portfolio renders REAL priced holdings from the mocked balances + prices,
 *  - Tokens renders the REAL token list and shows the "coming soon" trade-tape
 *    empty state (never fabricated trades),
 *  - Discover renders the REAL ranked tokens and the "coming soon" Launches
 *    empty state.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAINNET_TOKEN_ADDRESSES } from "../protocols";

const rpc = vi.hoisted(() => ({ balances: new Map<string, bigint>() }));
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

vi.mock("../data/client", async () => {
  const actual = await vi.importActual<typeof import("../data/client")>("../data/client");
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

vi.mock("lightweight-charts", () => ({
  CandlestickSeries: {},
  ColorType: { Solid: "solid" },
  createChart: () => ({
    addSeries: () => ({ setData: () => undefined }),
    timeScale: () => ({ fitContent: () => undefined }),
    remove: () => undefined,
  }),
}));

import Discover from "./Discover";
import Portfolio from "./Portfolio";
import Tokens from "./Tokens";

const ETH = MAINNET_TOKEN_ADDRESSES.ETH;
const USDC = MAINNET_TOKEN_ADDRESSES.USDC;

const respond = (body: unknown, status = 200) => ({
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
    logoUri: "u",
    market: {
      currentPrice: 2.18,
      marketCap: 142_600_000,
      starknetVolume24h: 412_000,
      priceChangePercentage24h: -3.4,
      totalLiquidityInUsd: 18_400_000,
    },
  },
];

beforeEach(() => {
  rpc.balances = new Map<string, bigint>([
    [ETH.toLowerCase(), 1_000_000_000_000_000_000n],
    [USDC.toLowerCase(), 500_000_000n],
  ]);
  globalThis.fetch = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes("avnu.fi")) {
      return respond(AVNU_TOKENS);
    }
    if (url.includes("simple/token_price")) {
      return respond({
        [ETH.toLowerCase()]: { usd: 3000, usd_24h_change: 2 },
        [USDC.toLowerCase()]: { usd: 1, usd_24h_change: 0 },
      });
    }
    if (url.includes("simple/price")) {
      return respond({
        ethereum: { usd: 3000, usd_24h_change: 2 },
        "usd-coin": { usd: 1, usd_24h_change: 0 },
        starknet: { usd: 0.14, usd_24h_change: 6 },
        tether: { usd: 1 },
        dai: { usd: 1 },
        "wrapped-bitcoin": { usd: 60_000 },
      });
    }
    if (url.includes("market_chart")) {
      return respond({ prices: [[0, 100], [1000, 110], [10_000_000, 120]] });
    }
    if (url.includes("ekubo.org")) {
      return respond([]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
});

describe("Portfolio screen", () => {
  it("renders real priced holdings from mocked balances + prices", async () => {
    render(<Portfolio />);
    // Holdings names appear once balances + prices resolve.
    expect(await screen.findByText("Ether")).toBeTruthy();
    expect(await screen.findByText("USD Coin")).toBeTruthy();
  });

  it("shows an explicit coming-soon empty state for activity (no fabricated rows)", async () => {
    render(<Portfolio />);
    await screen.findByText("Ether");
    fireEvent.click(screen.getByText("Perps Activity"));
    expect(await screen.findByText(/Activity history — coming soon/)).toBeTruthy();
  });
});

describe("Tokens screen", () => {
  it("renders the real token list and a coming-soon trade tape", async () => {
    render(<Tokens />);
    // Token from the mocked Avnu list appears in the left list + header.
    expect(await screen.findAllByText("Ekubo")).toBeTruthy();
    // The synthetic trade tape is replaced with an explicit empty state.
    expect(await screen.findByText(/Live trade tape — coming soon/)).toBeTruthy();
  });
});

describe("Discover screen", () => {
  it("renders real ranked tokens and a coming-soon Launches feed", async () => {
    render(<Discover />);
    expect(await screen.findByText("Ekubo")).toBeTruthy();
    expect(await screen.findByText(/Launches — coming soon/)).toBeTruthy();
  });
});
