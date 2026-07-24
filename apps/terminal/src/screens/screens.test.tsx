/**
 * Screen render tests with mocked network. The wallet, `fetch`, the RPC provider
 * (via the shared `withRpc`), and lightweight-charts are all stubbed so the
 * screens can be rendered in jsdom. These assert that:
 *  - Portfolio renders REAL priced holdings from the mocked balances + prices,
 *  - Tokens renders the REAL token list, AVNU chart history, and Ekubo fills,
 *  - Discover renders the REAL ranked tokens and indexed Starknet activity.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAINNET_TOKEN_ADDRESSES } from "../protocols";

const rpc = vi.hoisted(() => ({ balances: new Map<string, bigint>() }));
const wallet = vi.hoisted(() => ({
  requestTransaction: vi.fn(),
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
    requestTransaction: (request: unknown) => wallet.requestTransaction(request),
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

const ok = (data: unknown): unknown => ({ status: "OK", data, error: null });

const AVNU_TOKENS = [
  {
    address: "0xabc",
    name: "Ekubo",
    symbol: "EKUBO",
    decimals: 18,
    logoUri: "https://assets.avnu.fi/ekubo.svg",
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
    logoUri: "https://assets.avnu.fi/eth.svg",
    starknet: { usd: 3000, usdPriceChangePercentage24h: 2 },
    global: { usd: 3000, usdMarketCap: 300_000_000_000 },
  },
  {
    address: USDC,
    name: "USD Coin",
    symbol: "USDC",
    decimals: 6,
    logoUri: "https://assets.avnu.fi/usdc.svg",
    starknet: { usd: 1, usdPriceChangePercentage24h: 0 },
    global: { usd: 1, usdMarketCap: 50_000_000_000 },
  },
  {
    address: "0x0def",
    name: "Bridged USDC",
    symbol: "USDC.e",
    decimals: 6,
    logoUri: "https://assets.avnu.fi/usdc-e.svg",
    starknet: { usd: 1, usdPriceChangePercentage24h: 0 },
    global: { usd: 1, usdMarketCap: 50_000_000_000 },
  },
];

const EXTENDED_MARKET = {
  name: "BTC-USD",
  assetName: "BTC",
  assetPrecision: 5,
  collateralAssetName: "USD",
  collateralAssetPrecision: 6,
  active: true,
  type: "PERPETUAL",
  marketStats: {
    dailyVolume: "1280000000",
    dailyPriceChange: "1342.5",
    lastPrice: "63842.5",
    markPrice: "63842.5",
  },
  tradingConfig: { maxLeverage: "40", maxNumOrders: 200, riskFactorConfig: [] },
  l2Config: {
    type: "STARKX",
    collateralId: "0x1",
    collateralResolution: 1,
    syntheticId: "0x2",
    syntheticResolution: 1,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  wallet.requestTransaction.mockResolvedValue(undefined);
  swaps.avnuQuote.mockResolvedValue({
    buyAmount: "2000000000000000000",
    buyToken: "0xabc",
    gasFeesInStrk: "100000000000000000",
    minBuyAmount: "1990000000000000000",
    gasFeesInUsd: 0.08,
    priceImpactBps: 12,
    protocol: "avnu",
    routeLabels: ["Ekubo 70%", "Hashstack 30%"],
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
    if (url.includes("starkscan.co") && url.includes("/token-holdings")) {
      return respond({
        chainId: "SN_MAIN",
        ownerAddress: wallet.value.address,
        items: [
          {
            tokenAddress: ETH,
            normalizedTokenAddress: ETH,
            indexedBalanceRaw: "1000000000000000000",
            symbol: "ETH",
            name: "Ether",
            decimals: 18,
          },
          {
            tokenAddress: USDC,
            normalizedTokenAddress: USDC,
            indexedBalanceRaw: "500000000",
            symbol: "USDC",
            name: "USD Coin",
            decimals: 6,
          },
        ],
        exact: true,
        truncated: false,
        completeness: {
          exact: true,
          truncated: false,
          complete: true,
          reasonCode: "complete",
          reason: "Complete snapshot.",
          lagBlocks: 0,
          capped: false,
          cap: null,
        },
      });
    }
    if (url.includes("starkscan.co") && url.includes("/transactions?limit=30")) {
      return respond({
        items: [
          {
            blockNumber: 12_241_220,
            timestampIso: "2026-07-24T13:42:00.000Z",
            txIndex: 2,
            txHash: "0x7b",
            kinds: ["from", "token_in", "token_out"],
            counterparty: "0x1234567890abcdef",
            txType: "INVOKE",
            executionStatus: "SUCCEEDED",
            finalityStatus: "ACCEPTED_ON_L1",
            transferCount: 3,
            operationKind: "swap",
            operationLabel: "Swap on Ekubo",
            operationProtocolName: "Ekubo",
          },
        ],
        nextCursor: null,
      });
    }
    if (url.includes("starkscan.co") && url.includes("/blocks")) {
      return respond({
        items: [
          {
            blockNumber: 12_241_283,
            blockHash: "0x123",
            parentHash: "0x122",
            timestampIso: "2026-07-24T13:45:53.000Z",
            txCount: 3,
            finalityStatus: "ACCEPTED_ON_L2",
          },
        ],
        nextCursor: null,
      });
    }
    if (url.includes("starkscan.co") && url.includes("/block/12241283/txs")) {
      return respond({
        items: [
          {
            txHash: "0x4e0e",
            fromAddress: "0x111",
            toAddress: "0x222",
            executionStatus: "SUCCEEDED",
            finalityStatus: "ACCEPTED_ON_L2",
          },
        ],
        nextCursor: null,
      });
    }
    if (url.includes("starkscan.co") && url.includes("/events")) {
      return respond({
        items: [
          {
            blockNumber: 12_241_283,
            timestampIso: "2026-07-24T13:45:53.000Z",
            logIndex: 3,
            txHash: "0x4e0e",
            address: "0xfee",
            eventName: "Transfer",
            decodedFields: [],
            sourceTier: "head",
          },
          {
            blockNumber: 12_241_283,
            timestampIso: "2026-07-24T13:45:53.000Z",
            logIndex: 4,
            txHash: "0x4e0e",
            address: "0xswap",
            eventName: "Swapped",
            decodedFields: [
              {
                label: "route.variant",
                displayValue: "Ekubo",
              },
            ],
            sourceTier: "head",
          },
        ],
        nextCursor: null,
      });
    }
    if (url.includes("starkscan.co") && url.includes("/messages")) {
      return respond({
        items: [
          {
            id: "message-1",
            blockNumber: 12_241_282,
            timestampIso: "2026-07-24T13:45:52.000Z",
            txHash: "0xbridge",
            direction: "l1_to_l2",
            fromAddress: "0x333",
            toAddress: "0x444",
            status: "consumed",
            sourceTier: "finalized",
          },
        ],
        nextCursor: null,
      });
    }
    if (url.includes("/users/") && url.includes("/positions")) {
      return respond({
        data: [
          {
            collateral: {
              address: ETH,
              decimals: 18,
              symbol: "ETH",
              value: "2000000000000000000",
            },
            debt: {
              address: USDC,
              decimals: 6,
              symbol: "USDC",
              value: "1000000",
            },
            healthFactor: "1800000000000000000",
            id: "position-1",
            ltv: {
              current: "500000000000000000",
              max: "800000000000000000",
            },
            pool: { id: "0x123", name: "Prime" },
            protocolVersion: "v2",
            type: "borrow",
          },
        ],
      });
    }
    if (url.includes("/prices/line")) {
      return respond([
        { date: "2026-07-09T00:00:00Z", value: 2.1 },
        { date: "2026-07-09T01:00:00Z", value: 2.18 },
      ]);
    }
    if (url.includes("avnu.fi")) {
      return respond(AVNU_TOKENS);
    }
    if (url.includes("ekubo.org") && url.includes("/events")) {
      return respond({
        data: [
          {
            delta0: "-1000000000000000000",
            delta1: "2180000",
            locker: "456",
            timestamp: "2026-07-24T14:56:42.000Z",
            transaction_hash: "123",
            type: 0,
          },
        ],
      });
    }
    if (url.includes("ekubo.org")) {
      return respond([]);
    }
    if (url.includes("/info/markets")) {
      return respond(ok([EXTENDED_MARKET]));
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
  it("renders the real token list and verified live spot tape", async () => {
    render(<Tokens onNavigate={vi.fn()} />);
    // Token from the mocked Avnu list appears in the left list + header.
    expect(await screen.findAllByText("Ekubo")).toBeTruthy();
    expect(document.querySelector('img[src="https://assets.avnu.fi/ekubo.svg"]')).toBeTruthy();
    expect(await screen.findByText("Live spot fills")).toBeTruthy();
    expect(await screen.findByRole("article", { name: /buy 1 EKUBO for \$2.18/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "My Trades" }));
    expect(await screen.findByRole("article", { name: /buy 1 EKUBO for \$2.18/i })).toBeTruthy();
  });

  it("reloads chart identity and navigates its Perps tab", async () => {
    const onNavigate = vi.fn();
    render(<Tokens onNavigate={onNavigate} />);
    await screen.findAllByText("Ekubo");

    fireEvent.click(screen.getByRole("button", { name: /Ether ETH/ }));
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.some(([input]) =>
          String(input).includes(`/tokens/${encodeURIComponent(ETH)}/prices/line`),
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
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.some(([input]) =>
          String(input).includes(`/tokens/${encodeURIComponent(USDC)}/prices/line`),
        ),
      ).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "Perps" }));
    expect(onNavigate).toHaveBeenCalledWith("perps");
  });

  it("defaults to AVNU and builds through the selected swap route", async () => {
    render(<Tokens onNavigate={vi.fn()} />);
    await screen.findAllByText("Ekubo");
    expect(screen.getByText("Best execution by AVNU")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("You pay amount"), { target: { value: "1" } });
    await waitFor(() => expect(swaps.avnuQuote).toHaveBeenCalled(), { timeout: 1_500 });
    expect(swaps.avnuQuote).toHaveBeenLastCalledWith(
      expect.objectContaining({ slippageBps: 50, takerAddress: wallet.value.address }),
    );
    expect(await screen.findByText("0.1 STRK · $0.08")).toBeTruthy();
    expect(screen.getByText("Ekubo 70% · Hashstack 30%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review in wallet" }));
    expect(swaps.avnuBuild).toHaveBeenCalledWith(
      expect.objectContaining({ slippageBps: 50, takerAddress: wallet.value.address }),
    );
    await waitFor(() =>
      expect(wallet.requestTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.arrayContaining([
            { label: "Estimated network fee", value: "0.1 STRK · $0.08" },
          ]),
          reviewMode: "wallet",
        }),
      ),
    );

    fireEvent.click(screen.getByLabelText("Swap settings"));
    fireEvent.click(screen.getByRole("button", { name: "Ekubo direct" }));
    await waitFor(() => expect(swaps.ekuboQuote).toHaveBeenCalled(), { timeout: 1_500 });
    fireEvent.click(screen.getByRole("button", { name: "Review in wallet" }));
    expect(swaps.ekuboBuild).toHaveBeenCalled();
  });

  it("quotes any selected token pair and reverses it without resetting to ETH", async () => {
    render(<Tokens onNavigate={vi.fn()} />);
    await screen.findAllByText("Ekubo");

    fireEvent.click(screen.getByRole("button", { name: "Select ETH token" }));
    fireEvent.click(screen.getByRole("option", { name: /USDC USD Coin/ }));

    expect(screen.getByRole("button", { name: "Select USDC token" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select EKUBO token" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("You pay amount"), { target: { value: "1.5" } });
    await waitFor(
      () =>
        expect(swaps.avnuQuote).toHaveBeenLastCalledWith(
          expect.objectContaining({
            buyToken: "0xabc",
            sellAmount: "1500000",
            sellToken: USDC,
          }),
        ),
      { timeout: 1_500 },
    );

    const reverse = screen.getByRole("button", { name: "Switch swap direction" });
    expect(reverse.classList.contains("reversed")).toBe(false);
    fireEvent.click(reverse);

    expect(reverse.classList.contains("reversed")).toBe(true);
    expect(screen.getByRole("button", { name: "Select EKUBO token" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select USDC token" })).toBeTruthy();
    await waitFor(
      () =>
        expect(swaps.avnuQuote).toHaveBeenLastCalledWith(
          expect.objectContaining({
            buyToken: USDC,
            sellAmount: "1500000000000000000",
            sellToken: "0xabc",
          }),
        ),
      { timeout: 1_500 },
    );
  });
});

describe("Discover screen", () => {
  it("renders wallet positions, activity, ranked markets, and indexed chain events", async () => {
    render(<Discover onNavigate={vi.fn()} />);
    expect(await screen.findByText("Borrow ETH")).toBeTruthy();
    expect(await screen.findByText("2 ETH · 1 USDC debt")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Activities/ }));
    expect(await screen.findByText("Swap on Ekubo")).toBeTruthy();
    expect(await screen.findByText("Ekubo")).toBeTruthy();
    expect(await screen.findByText("BTC-USD")).toBeTruthy();
    expect(document.querySelector('img[src="/token-assets/extended/BTC.svg"]')).toBeTruthy();
    expect(await screen.findByText("Starknet live")).toBeTruthy();
    expect(await screen.findByText("L1 → L2 message", {}, { timeout: 4_000 })).toBeTruthy();
    expect(await screen.findByText("Transaction succeeded", {}, { timeout: 4_000 })).toBeTruthy();
    expect(await screen.findByText("Swapped", {}, { timeout: 4_000 })).toBeTruthy();
    expect(screen.queryByText("Transfer")).toBeNull();
    expect(screen.getAllByText("Head").length).toBeGreaterThan(0);
    expect(screen.queryByText("Bridged USDC")).toBeNull();
  });

  it("provides functional ranking controls", async () => {
    render(<Discover onNavigate={vi.fn()} />);
    await screen.findByText("Ekubo");
    fireEvent.change(screen.getByLabelText("Sort tokens"), { target: { value: "volume" } });
    fireEvent.change(screen.getByLabelText("Sort perps"), { target: { value: "change" } });
    expect((screen.getByLabelText("Sort tokens") as HTMLSelectElement).value).toBe("volume");
    expect((screen.getByLabelText("Sort perps") as HTMLSelectElement).value).toBe("change");
  });

  it("shares followed markets with the Discover Follows tab", async () => {
    const tokenScreen = render(<Tokens onNavigate={vi.fn()} />);
    await screen.findAllByText("Ekubo");
    const followButton = screen.getByRole("button", { name: "Follow" });
    expect(followButton.textContent).toBe("");
    fireEvent.click(followButton);
    tokenScreen.unmount();

    render(<Discover onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Follows/ }));
    expect(await screen.findByRole("button", { name: "Open followed Ekubo" })).toBeTruthy();
  });
});
