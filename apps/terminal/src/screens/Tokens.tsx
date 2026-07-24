/**
 * Tokens screen — the three-pane token terminal. LEFT: a token list from the
 * real token universe (`useTokens` — Avnu market list, Ekubo fallback), click to
 * select. CENTER: the selected token's header + market stats (price / market cap
 * / liquidity / 24h volume / 24h change, all real from the token API + live
 * `usePrices`), a candlestick chart fed by AVNU OHLC from `useCandles`, and a
 * trade tape that has NO confirmed
 * source and therefore renders an explicit "coming soon" empty state (never
 * fabricated trades). RIGHT: a configurable Buy/Sell panel that quotes AVNU or
 * Ekubo against the selected token and builds calls for wallet review.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Coins, LineChart, Plus, Receipt } from "lucide-react";
import type { Call } from "starknet";
import {
  CandlestickChart,
  EmptyState,
  ErrorBanner,
  PctChange,
  SegmentedTabs,
  SkeletonChart,
  SkeletonRows,
  StatPair,
  TabStrip,
  TokenIcon,
} from "../components";
import { avnu, ekubo, MAINNET_TOKEN_ADDRESSES, MAINNET_TOKEN_DECIMALS } from "../protocols";
import type { SwapQuote } from "../protocols";
import {
  formatCompactUsd,
  formatPrice,
  useCandles,
  usePrices,
  useTokens,
  type TokenRow,
} from "../data";
import { shortenAddress } from "../shell/screens";
import type { ScreenId } from "../shell/screens";
import { useWallet } from "../wallet/WalletProvider";
import { QUICK_AMOUNTS, TIMEFRAMES } from "./tokensData";

type LeftTab = "tokens" | "perps" | "follows";
type TradeTab = "trades" | "mine" | "positions" | "top" | "holders";
type Side = "buy" | "sell";
type SwapVenue = "avnu" | "ekubo";

const ETH_ADDRESS = MAINNET_TOKEN_ADDRESSES.ETH;
const ETH_DECIMALS = MAINNET_TOKEN_DECIMALS.ETH;
const DOLLAR_STABLE_SYMBOL = /^(?:USDC|USDT|DAI)/i;

// Parses a human decimal amount into a smallest-unit integer string using pure
// string math (no float rounding). Returns null for empty/invalid/zero input.
const toSmallestUnit = (amount: string, decimals: number): string | null => {
  const trimmed = amount.trim();
  if (trimmed === "" || !/^\d*\.?\d*$/.test(trimmed)) {
    return null;
  }
  const [intPart = "0", fracRaw = ""] = trimmed.split(".");
  const frac = fracRaw.slice(0, decimals).padEnd(decimals, "0");
  const combined = `${intPart}${frac}`.replace(/^0+/, "");
  if (combined === "") {
    return null;
  }
  return combined;
};

// Formats a smallest-unit integer string back to a human number for display.
const fromSmallestUnit = (raw: string, decimals: number): string => {
  const padded = raw.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals).replace(/0+$/, "");
  const value = Number(fracPart === "" ? intPart : `${intPart}.${fracPart}`);
  if (!Number.isFinite(value)) {
    return raw;
  }
  if (value === 0) {
    return "0";
  }
  const digits = value < 1 ? 6 : value < 1000 ? 4 : 2;
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
};

type QuoteState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly quote: SwapQuote; readonly receiveDecimals: number }
  | { readonly status: "error"; readonly message: string };

const LEFT_TABS: readonly { value: LeftTab; label: string }[] = [
  { value: "tokens", label: "Tokens" },
  { value: "perps", label: "Perps" },
  { value: "follows", label: "Follows" },
];

const TRADE_TABS: readonly { value: TradeTab; label: string }[] = [
  { value: "trades", label: "Trades" },
  { value: "mine", label: "My Trades" },
  { value: "positions", label: "Positions" },
  { value: "top", label: "Top Traders" },
  { value: "holders", label: "Holders" },
];

const SIDE_OPTIONS = [
  { value: "buy" as const, label: "Buy", tone: "buy" as const },
  { value: "sell" as const, label: "Sell", tone: "sell" as const },
];

const SWAP_VENUES: readonly { readonly value: SwapVenue; readonly label: string }[] = [
  { value: "avnu", label: "AVNU Aggregator" },
  { value: "ekubo", label: "Ekubo Direct" },
];

const SLIPPAGE_OPTIONS = [10, 50, 100] as const;

const priceLabel = (value: number | null): string => (value === null ? "—" : formatPrice(value));
const compactLabel = (value: number | null): string =>
  value === null ? "—" : formatCompactUsd(value);

type TokensProps = { readonly onNavigate: (screen: ScreenId) => void };

export default function Tokens({ onNavigate }: TokensProps): ReactNode {
  const {
    address,
    isConnected,
    isConnecting,
    connect,
    requestTransaction,
  } = useWallet();

  const tokens = useTokens();
  const list = useMemo<readonly TokenRow[]>(() => tokens.data ?? [], [tokens.data]);

  const [leftTab, setLeftTab] = useState<LeftTab>("tokens");
  const [tradeTab, setTradeTab] = useState<TradeTab>("trades");
  const [selected, setSelected] = useState(0);
  const [timeframe, setTimeframe] = useState("1d");
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("0.0");
  const [swapVenue, setSwapVenue] = useState<SwapVenue>("avnu");
  const [slippageBps, setSlippageBps] = useState<number>(50);
  const [followed, setFollowed] = useState<ReadonlySet<string>>(() => new Set());

  const [quoteState, setQuoteState] = useState<QuoteState>({ status: "idle" });
  const [reviewCalls, setReviewCalls] = useState<readonly Call[] | null>(null);
  const [execMessage, setExecMessage] = useState<string | null>(null);

  const token: TokenRow | undefined = list[selected] ?? list[0];
  const isFollowed = token !== undefined && followed.has(token.address);
  const visibleTokens = useMemo(
    () =>
      list
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => leftTab === "tokens" || followed.has(item.address)),
    [followed, leftTab, list],
  );

  const onLeftTabChange = (value: LeftTab): void => {
    if (value === "perps") {
      onNavigate("perps");
      return;
    }
    setLeftTab(value);
  };

  const toggleFollow = (): void => {
    if (token === undefined) {
      return;
    }
    setFollowed((current) => {
      const next = new Set(current);
      if (next.has(token.address)) {
        next.delete(token.address);
      } else {
        next.add(token.address);
      }
      return next;
    });
  };

  // Live price/change for the selected token, overriding the list snapshot.
  const prices = usePrices(token !== undefined ? [token.address] : []);
  const livePrice = token === undefined ? undefined : prices.data?.byAddress[token.address.toLowerCase()];
  const priceUsd = livePrice?.usd ?? token?.priceUsd ?? null;
  const change24h = livePrice?.change24h ?? token?.change24h ?? null;

  // Real OHLC candles for the chart.
  const candleAddress =
    token === undefined || DOLLAR_STABLE_SYMBOL.test(token.symbol) ? null : token.address;
  const candles = useCandles(candleAddress, timeframe);

  // Buy = spend ETH to receive the selected token; Sell = spend the selected
  // token to receive ETH. Quoting needs both ERC20 addresses.
  const spend =
    side === "buy"
      ? { symbol: "ETH", address: ETH_ADDRESS, decimals: ETH_DECIMALS }
      : { symbol: token?.symbol ?? "", address: token?.address ?? "", decimals: token?.decimals ?? 18 };
  const receive =
    side === "buy"
      ? { symbol: token?.symbol ?? "", address: token?.address ?? "", decimals: token?.decimals ?? 18 }
      : { symbol: "ETH", address: ETH_ADDRESS, decimals: ETH_DECIMALS };

  // Reset the review/exec flow whenever the trade inputs change.
  useEffect(() => {
    setReviewCalls(null);
    setExecMessage(null);
  }, [amount, side, selected, slippageBps, swapVenue]);

  // Quote the swap on amount / pair change. Only runs with a connected address,
  // known token addresses, and a positive amount. The selected venue is explicit
  // so a user always knows which router will receive approval.
  useEffect(() => {
    if (!isConnected || address === null || token === undefined) {
      setQuoteState({ status: "idle" });
      return;
    }
    if (spend.address === "" || receive.address === "") {
      setQuoteState({ status: "error", message: "No route for this token yet." });
      return;
    }
    if (spend.address === receive.address) {
      setQuoteState({ status: "error", message: "Pick a token other than ETH." });
      return;
    }
    const sellAmount = toSmallestUnit(amount, spend.decimals);
    if (sellAmount === null) {
      setQuoteState({ status: "idle" });
      return;
    }
    const sellToken = spend.address;
    const buyToken = receive.address;
    const receiveDecimals = receive.decimals;
    let cancelled = false;
    setQuoteState({ status: "loading" });
    const handle = window.setTimeout(() => {
      const params = {
        sellToken,
        buyToken,
        sellAmount,
        takerAddress: address,
        slippageBps,
      };
      void (async () => {
        try {
          const quote: SwapQuote = await (swapVenue === "avnu" ? avnu : ekubo).quoteSwap(params);
          if (!cancelled) {
            setQuoteState({ status: "ready", quote, receiveDecimals });
          }
        } catch (error) {
          if (!cancelled) {
            const message =
              error instanceof Error ? error.message : "Could not fetch a quote.";
            setQuoteState({ status: "error", message });
          }
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [
    isConnected, address, amount, side, selected, token,
    spend.address, spend.decimals, receive.address, receive.decimals, slippageBps, swapVenue,
  ]);

  const onReview = useCallback(() => {
    if (quoteState.status !== "ready" || address === null) {
      return;
    }
    setExecMessage(null);
    try {
      const protocol = quoteState.quote.protocol === "avnu" ? avnu : ekubo;
      const calls = protocol.buildSwapCalls({
        quote: quoteState.quote,
        slippageBps,
        takerAddress: address,
      });
      setReviewCalls(calls);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not build the swap.";
      setExecMessage(message);
    }
  }, [quoteState, address, slippageBps]);

  const onConfirm = useCallback(() => {
    if (reviewCalls === null) {
      return;
    }
    setExecMessage("Opening transaction review…");
    void (async () => {
      try {
        await requestTransaction({
          calls: reviewCalls,
          description:
            "Submit the reviewed swap route. Your wallet will show the final calldata and network fee before approval.",
          details: [
            { label: "Action", value: `${side === "buy" ? "Buy" : "Sell"} ${token?.symbol ?? "token"}` },
            { label: "Input", value: `${amount} ${spend.symbol}` },
            { label: "Venue", value: swapVenue === "avnu" ? "AVNU Aggregator" : "Ekubo Direct" },
            { label: "Max slippage", value: `${(slippageBps / 100).toFixed(2)}%` },
          ],
          title: `Review ${token?.symbol ?? "token"} swap`,
          warning: "Swap output can change before execution. Verify the wallet fee and minimum received.",
        });
        setExecMessage("Transaction submitted.");
        setReviewCalls(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Wallet rejected the swap.";
        setExecMessage(message);
      }
    })();
  }, [
    amount,
    requestTransaction,
    reviewCalls,
    side,
    slippageBps,
    spend.symbol,
    swapVenue,
    token?.symbol,
  ]);

  // No token available yet: render the pane shell with loading/empty affordances.
  if (token === undefined) {
    return (
      <div className="screen" id="tokens">
        {tokens.error !== null && <ErrorBanner message={`Couldn't load tokens: ${tokens.error}`} />}
        <div className="pane3">
          <div className="leftlist">
            <TabStrip
              items={LEFT_TABS}
              value={leftTab}
              onChange={onLeftTabChange}
              style={{ padding: "0 4px" }}
            />
            <div className="listscroll">
              {tokens.isLoading ? (
                <SkeletonRows rows={10} />
              ) : (
                <EmptyState
                  icon={<Coins size={22} strokeWidth={1.75} />}
                  title="No tokens available"
                  style={{ minHeight: 200 }}
                />
              )}
            </div>
          </div>
          <div className="center">
            <EmptyState
              icon={<Coins size={22} strokeWidth={1.75} />}
              title="Select a token"
              style={{ flex: 1 }}
            />
          </div>
          <div className="rightpanel" />
        </div>
      </div>
    );
  }

  const candleData = candles.data ?? [];

  const ctaLabel = !isConnected
    ? "Connect Wallet"
    : reviewCalls !== null
      ? "Confirm in wallet"
      : "Review swap";
  const ctaDisabled =
    isConnecting ||
    (isConnected && reviewCalls === null && quoteState.status !== "ready");
  const onCta = !isConnected ? () => void connect() : reviewCalls !== null ? onConfirm : onReview;

  return (
    <div className="screen" id="tokens">
      {tokens.error !== null && <ErrorBanner message={`Couldn't load tokens: ${tokens.error}`} />}
      <div className="pane3">
        {/* LEFT: token list */}
        <div className="leftlist">
          <TabStrip
            items={LEFT_TABS}
            value={leftTab}
            onChange={onLeftTabChange}
            style={{ padding: "0 4px" }}
          />
          <div className="listscroll">
            {visibleTokens.length === 0 ? (
              <EmptyState
                icon={<Check size={22} strokeWidth={1.75} />}
                title="No followed tokens"
                subtitle="Follow a token to keep it in this list."
                style={{ minHeight: 200 }}
              />
            ) : (
              visibleTokens.map(({ item: t, index: i }) => (
                <button
                  type="button"
                  key={t.address}
                  className={i === selected ? "tokrow sel" : "tokrow"}
                  onClick={() => setSelected(i)}
                >
                  <TokenIcon symbol={t.symbol} size={30} colorIndex={i} />
                  <div>
                    <div className="n1">{t.name}</div>
                    <div className="n2">{t.symbol}</div>
                  </div>
                  <div className="r">
                    <div className="pr mono">{priceLabel(t.priceUsd)}</div>
                    {t.change24h === null ? (
                      <span className="ch tiny">—</span>
                    ) : (
                      <PctChange value={t.change24h} digits={1} className="ch" />
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* CENTER: header + chart + trades */}
        <div className="center">
          <div className="tokhead">
            <div className="top">
              <TokenIcon symbol={token.symbol} size={40} colorIndex={selected} />
              <div>
                <h2>
                  {token.name}{" "}
                  <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
                    {token.symbol}
                  </span>
                </h2>
                <div className="tiny">
                  Starknet ·{" "}
                  <span style={{ color: "var(--text-2)" }}>{shortenAddress(token.address)}</span>
                </div>
              </div>
              <button
                type="button"
                className="followbtn"
                style={{ marginLeft: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
                onClick={toggleFollow}
              >
                {isFollowed ? (
                  <>
                    <Check size={14} strokeWidth={2} /> Following
                  </>
                ) : (
                  <>
                    <Plus size={14} strokeWidth={2} /> Follow
                  </>
                )}
              </button>
              <div
                className="miniStats"
                style={{ marginLeft: "auto", border: "none", padding: 0, gap: 16 }}
              >
                <StatPair variant="mini" label="24h Vol" value={compactLabel(token.volume24hUsd)} />
                <StatPair variant="mini" label="Mkt Cap" value={compactLabel(token.marketCapUsd)} />
                <StatPair
                  variant="mini"
                  label="24h"
                  value={change24h === null ? "—" : <PctChange value={change24h} digits={2} />}
                />
              </div>
            </div>
            <div className="statgrid">
              <StatPair label="Price" value={priceLabel(priceUsd)} />
              <StatPair label="Market Cap" value={compactLabel(token.marketCapUsd)} />
              <StatPair
                label="24h Change"
                value={change24h === null ? "—" : <PctChange value={change24h} digits={2} />}
              />
              <StatPair label="Liquidity" value={compactLabel(token.liquidityUsd)} />
              <StatPair label="24h Volume" value={compactLabel(token.volume24hUsd)} />
              <StatPair label="Decimals" value={String(token.decimals)} />
              <StatPair label="Contract" value={shortenAddress(token.address)} />
            </div>
          </div>

          <div className="chartwrap">
            <div className="tfbar">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  className={tf === timeframe ? "tf active" : "tf"}
                  onClick={() => setTimeframe(tf)}
                >
                  {tf}
                </button>
              ))}
              <div className="right">
                <button
                  type="button"
                  className="tf"
                  style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
                >
                  Candles
                </button>
              </div>
            </div>
            {candles.isLoading && candleData.length === 0 ? (
              <SkeletonChart height={320} />
            ) : candleData.length > 0 ? (
              <CandlestickChart key={token.address + timeframe} data={candleData} />
            ) : (
              <EmptyState
                icon={<LineChart size={22} strokeWidth={1.75} />}
                title="Chart data unavailable"
                subtitle={
                  candles.error !== null
                    ? "The price history source didn't return data for this token."
                    : "No price history is available for this token yet."
                }
                style={{ minHeight: 320 }}
              />
            )}
          </div>

          <div className="tradetabs">
            <TabStrip items={TRADE_TABS} value={tradeTab} onChange={setTradeTab} />
            {tradeTab === "trades" ? (
              <EmptyState
                icon={<Receipt size={22} strokeWidth={1.75} />}
                title="Live trade tape — coming soon"
                subtitle="A verified on-chain trade feed for this token isn't wired to a source yet. This is an empty state, not sample trades."
                style={{ minHeight: 160 }}
              />
            ) : (
              <div className="tiny" style={{ padding: "20px 16px", textAlign: "center" }}>
                {isConnected
                  ? "No data to show yet."
                  : "Connect your wallet to see this view."}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: trade panel */}
        <div className="rightpanel">
          <div className="rp-inner">
            <SegmentedTabs
              variant="seg"
              options={SIDE_OPTIONS}
              value={side}
              onChange={setSide}
            />
            <div className="amtbox">
              <div className="tiny" style={{ marginBottom: 4 }}>
                Amount
              </div>
              <div className="row">
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <div className="cur">
                  <TokenIcon
                    symbol={spend.symbol}
                    size={20}
                    colorIndex={side === "buy" ? 1 : selected}
                  />
                  {spend.symbol}
                </div>
              </div>
            </div>
            <div className="chips">
              {QUICK_AMOUNTS.map((q) => (
                <button key={q} type="button" className="chip" onClick={() => setAmount(q)}>
                  {q}
                </button>
              ))}
            </div>

            <div className="swap-controls">
              <label>
                <span>Route</span>
                <select
                  aria-label="Swap route"
                  value={swapVenue}
                  onChange={(event) => setSwapVenue(event.target.value as SwapVenue)}
                >
                  {SWAP_VENUES.map((venue) => (
                    <option key={venue.value} value={venue.value}>
                      {venue.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Slippage</span>
                <select
                  aria-label="Slippage tolerance"
                  value={slippageBps}
                  onChange={(event) => setSlippageBps(Number(event.target.value))}
                >
                  {SLIPPAGE_OPTIONS.map((bps) => (
                    <option key={bps} value={bps}>
                      {bps / 100}%
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="tiny" style={{ marginBottom: 10, minHeight: 16 }}>
              {quoteState.status === "loading" && <span>Fetching quote…</span>}
              {quoteState.status === "ready" && (
                <span className="pos">
                  ≈ {fromSmallestUnit(quoteState.quote.buyAmount, quoteState.receiveDecimals)}{" "}
                  {receive.symbol} via {quoteState.quote.protocol}
                </span>
              )}
              {quoteState.status === "error" && (
                <span className="neg">{quoteState.message}</span>
              )}
              {quoteState.status === "idle" && !isConnected && (
                <span>Connect a wallet for a live quote.</span>
              )}
            </div>

            <button
              type="button"
              className="bigcta"
              onClick={() => void onCta()}
              disabled={ctaDisabled}
              style={ctaDisabled ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
            >
              {ctaLabel}
            </button>

            {reviewCalls !== null && quoteState.status === "ready" && (
              <div className="infoblock" style={{ marginTop: 0, marginBottom: 14 }}>
                <div className="ir">
                  <span className="k">You pay</span>
                  <span className="v">
                    {amount} {spend.symbol}
                  </span>
                </div>
                <div className="ir">
                  <span className="k">You receive ≈</span>
                  <span className="v">
                    {fromSmallestUnit(quoteState.quote.buyAmount, quoteState.receiveDecimals)}{" "}
                    {receive.symbol}
                  </span>
                </div>
                <div className="ir">
                  <span className="k">Min received</span>
                  <span className="v">
                    {fromSmallestUnit(quoteState.quote.minBuyAmount, quoteState.receiveDecimals)}{" "}
                    {receive.symbol}
                  </span>
                </div>
                <div className="ir">
                  <span className="k">Route</span>
                  <span className="v">{quoteState.quote.protocol.toUpperCase()}</span>
                </div>
                <div className="ir">
                  <span className="k">Slippage</span>
                  <span className="v">{slippageBps / 100}%</span>
                </div>
                <div className="ir">
                  <span className="k">Calls</span>
                  <span className="v">{reviewCalls.length}</span>
                </div>
              </div>
            )}
            {execMessage !== null && (
              <div className="tiny" style={{ marginBottom: 14 }}>
                {execMessage}
              </div>
            )}

            <div className="rp-title">Token Info</div>
            <div className="infoblock">
              <div className="ir">
                <span className="k">Symbol</span>
                <span className="v">{token.symbol}</span>
              </div>
              <div className="ir">
                <span className="k">Price</span>
                <span className="v">{priceLabel(priceUsd)}</span>
              </div>
              <div className="ir">
                <span className="k">Market Cap</span>
                <span className="v">{compactLabel(token.marketCapUsd)}</span>
              </div>
              <div className="ir">
                <span className="k">24h Volume</span>
                <span className="v">{compactLabel(token.volume24hUsd)}</span>
              </div>
              <div className="ir">
                <span className="k">Liquidity</span>
                <span className="v">{compactLabel(token.liquidityUsd)}</span>
              </div>
              <div className="ir">
                <span className="k">Decimals</span>
                <span className="v">{token.decimals}</span>
              </div>
              <div className="ir">
                <span className="k">Contract</span>
                <span className="v">{shortenAddress(token.address)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
