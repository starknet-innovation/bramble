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
const swaps = vi.hoisted(() => ({
  avnuBuild: vi.fn(),
  avnuQuote: vi.fn(),
  ekuboBuild: vi.fn(),
  ekuboQuote: vi.fn(),
}));

vi.mock("../protocols", async () => {
  const actual = await vi.importActual<typeof import("../protocols")>("../protocols");
  return {
    ...actual,
    avnu: { ...actual.avnu, buildSwapCalls: swaps.avnuBuild, quoteSwap: swaps.avnuQuote },
    ekubo: { ...actual.ekubo, buildSwapCalls: swaps.ekuboBuild, quoteSwap: swaps.ekuboQuote },
  };
});

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
  {
    address: ETH,
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
    starknet: { usd: 3000, usdPriceChangePercentage24h: 2 },
    global: { usd: 3000, usdMarketCap: 300_000_000_000 },
  },
  {
    address: USDC,
    name: "USD Coin",
    symbol: "USDC",
    decimals: 6,
    starknet: { usd: 1, usdPriceChangePercentage24h: 0 },
    global: { usd: 1, usdMarketCap: 50_000_000_000 },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  swaps.avnuQuote.mockResolvedValue({
    buyAmount: "2000000000000000000",
    buyToken: "0xabc",
    minBuyAmount: "1990000000000000000",
    protocol: "avnu",
    route: { protocol: "avnu" },
    sellAmount: "1000000000000000000",
    sellToken: ETH,
  });
  swaps.ekuboQuote.mockResolvedValue({
    buyAmount: "1900000000000000000",
    buyToken: "0xabc",
    minBuyAmount: "1890000000000000000",
    protocol: "ekubo",
    route: { protocol: "ekubo" },
    sellAmount: "1000000000000000000",
    sellToken: ETH,
  });
  swaps.avnuBuild.mockReturnValue([
    { calldata: [], contractAddress: "0xabc", entrypoint: "approve" },
  ]);
  swaps.ekuboBuild.mockReturnValue([
    { calldata: [], contractAddress: "0xabc", entrypoint: "swap" },
  ]);
  rpc.balances = new Map<string, bigint>([
    [ETH.toLowerCase(), 1_000_000_000_000_000_000n],
    [USDC.toLowerCase(), 500_000_000n],
  ]);
  globalThis.fetch = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes("/prices/candle")) {
      return respond([
        { date: "2026-07-09T00:00:00Z", open: 100, high: 110, low: 95, close: 105 },
      ]);
    }
    if (url.includes("avnu.fi")) {
      return respond(AVNU_TOKENS);
    }
    if (url.includes("ekubo.org")) {
      return respond([]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
});

describe("Portfolio screen", () => {
  it("renders real priced holdings from mocked balances + prices", async () => {
    render(<Portfolio onNavigate={vi.fn()} />);
    // Holdings names appear once balances + prices resolve.
    expect(await screen.findByText("Ether")).toBeTruthy();
    expect(await screen.findByText("USD Coin")).toBeTruthy();
  });

  it("shows an explicit coming-soon empty state for activity (no fabricated rows)", async () => {
    render(<Portfolio onNavigate={vi.fn()} />);
    await screen.findByText("Ether");
    fireEvent.click(screen.getByText("Perps Activity"));
    expect(await screen.findByText(/Activity history — coming soon/)).toBeTruthy();
  });

  it("routes the Perps portfolio tab to the live workspace", async () => {
    const onNavigate = vi.fn();
    render(<Portfolio onNavigate={onNavigate} />);
    await screen.findByText("Ether");

    const perpsTabs = screen.getAllByRole("button", { name: "Perps" });
    fireEvent.click(perpsTabs[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Open Perps" }));
    expect(onNavigate).toHaveBeenCalledWith("perps");
  });
});

describe("Tokens screen", () => {
  it("renders the real token list and a coming-soon trade tape", async () => {
    render(<Tokens onNavigate={vi.fn()} />);
    // Token from the mocked Avnu list appears in the left list + header.
    expect(await screen.findAllByText("Ekubo")).toBeTruthy();
    // The synthetic trade tape is replaced with an explicit empty state.
    expect(await screen.findByText(/Live trade tape — coming soon/)).toBeTruthy();
  });

  it("reloads chart identity and navigates its Perps tab", async () => {
    const onNavigate = vi.fn();
    render(<Tokens onNavigate={onNavigate} />);
    await screen.findAllByText("Ekubo");

    fireEvent.click(screen.getByRole("button", { name: /Ether ETH/ }));
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.some(([input]) =>
          String(input).includes(`/tokens/${encodeURIComponent(ETH)}/prices/candle`),
        ),
      ).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "5d" }));
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.some(
          ([input]) => String(input).includes(encodeURIComponent(ETH)) && String(input).includes("resolution=1H"),
        ),
      ).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: /USD Coin USDC/ }));
    await waitFor(() => expect(screen.getAllByText("USD Coin").length).toBeGreaterThan(1));
    expect(
      vi.mocked(fetch).mock.calls.some(
        ([input]) =>
          String(input).includes(`/tokens/${encodeURIComponent(USDC)}/prices/candle`),
      ),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Perps" }));
    expect(onNavigate).toHaveBeenCalledWith("perps");
  });

  it("defaults to AVNU and builds through the selected swap route", async () => {
    render(<Tokens onNavigate={vi.fn()} />);
    await screen.findAllByText("Ekubo");
    expect((screen.getByLabelText("Swap route") as HTMLSelectElement).value).toBe("avnu");

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "1" } });
    await waitFor(() => expect(swaps.avnuQuote).toHaveBeenCalled(), { timeout: 1_500 });
    expect(swaps.avnuQuote).toHaveBeenLastCalledWith(
      expect.objectContaining({ slippageBps: 50, takerAddress: wallet.value.address }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Review swap" }));
    expect(swaps.avnuBuild).toHaveBeenCalledWith(
      expect.objectContaining({ slippageBps: 50, takerAddress: wallet.value.address }),
    );

    fireEvent.change(screen.getByLabelText("Swap route"), { target: { value: "ekubo" } });
    await waitFor(() => expect(swaps.ekuboQuote).toHaveBeenCalled(), { timeout: 1_500 });
    fireEvent.click(screen.getByRole("button", { name: "Review swap" }));
    expect(swaps.ekuboBuild).toHaveBeenCalled();
  });
});

describe("Discover screen", () => {
  it("renders real ranked tokens and a coming-soon Launches feed", async () => {
    render(<Discover />);
    expect(await screen.findByText("Ekubo")).toBeTruthy();
    expect(await screen.findByText(/Launches — coming soon/)).toBeTruthy();
  });

  it("provides functional ranking controls", async () => {
    render(<Discover />);
    await screen.findByText("Ekubo");
    fireEvent.change(screen.getByLabelText("Sort tokens"), { target: { value: "volume" } });
    fireEvent.change(screen.getByLabelText("Sort perps"), { target: { value: "change" } });
    expect((screen.getByLabelText("Sort tokens") as HTMLSelectElement).value).toBe("volume");
    expect((screen.getByLabelText("Sort perps") as HTMLSelectElement).value).toBe("change");
  });
});
