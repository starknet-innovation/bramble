/**
 * Tokens screen — the three-pane token terminal. LEFT: a Tokens/Perps/Follows/
 * Track tab strip over a scrollable token list (click to select). CENTER: the
 * selected token's header (icon, name, follow, mini stats, stat grid), a
 * candlestick chart with a timeframe bar, and a trades tab strip with a sample
 * trade tape. RIGHT: a Buy/Sell trade panel that quotes a real Ekubo swap
 * (AVNU fallback) on amount change and, once connected, builds the swap calls
 * for a review + confirm-in-wallet flow. See the MANIFEST.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Call } from "starknet";
import {
  CandlestickChart,
  PctChange,
  SegmentedTabs,
  StatPair,
  TabStrip,
  TokenIcon,
} from "../components";
import { avnu, ekubo, MAINNET_TOKEN_ADDRESSES, MAINNET_TOKEN_DECIMALS } from "../protocols";
import type { SwapQuote } from "../protocols";
import { useWallet } from "../wallet/WalletProvider";
import {
  buildSampleTrades,
  QUICK_AMOUNTS,
  SAMPLE_TOKENS,
  TIMEFRAMES,
  type SampleToken,
} from "./tokensData";

type LeftTab = "tokens" | "perps" | "follows" | "track";
type TradeTab = "trades" | "mine" | "positions" | "top" | "holders";
type Side = "buy" | "sell";

const ETH_ADDRESS = MAINNET_TOKEN_ADDRESSES.ETH;
const ETH_DECIMALS = MAINNET_TOKEN_DECIMALS.ETH;

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
  { value: "track", label: "Track" },
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

export default function Tokens(): ReactNode {
  const { account, address, isConnected, isConnecting, connect } = useWallet();

  const [leftTab, setLeftTab] = useState<LeftTab>("tokens");
  const [tradeTab, setTradeTab] = useState<TradeTab>("trades");
  const [selected, setSelected] = useState(0);
  const [timeframe, setTimeframe] = useState("1d");
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("0.0");
  const [followed, setFollowed] = useState(false);

  const [quoteState, setQuoteState] = useState<QuoteState>({ status: "idle" });
  const [reviewCalls, setReviewCalls] = useState<readonly Call[] | null>(null);
  const [execMessage, setExecMessage] = useState<string | null>(null);

  const token: SampleToken = SAMPLE_TOKENS[selected] ?? SAMPLE_TOKENS[0]!;
  const trades = useMemo(() => buildSampleTrades(token.symbol, token.priceNum), [token]);

  // Buy = spend ETH to receive the selected token; Sell = spend the selected
  // token to receive ETH. Quoting needs both ERC20 addresses.
  const spend =
    side === "buy"
      ? { symbol: "ETH", address: ETH_ADDRESS, decimals: ETH_DECIMALS }
      : { symbol: token.symbol, address: token.address, decimals: token.decimals };
  const receive =
    side === "buy"
      ? { symbol: token.symbol, address: token.address, decimals: token.decimals }
      : { symbol: "ETH", address: ETH_ADDRESS, decimals: ETH_DECIMALS };

  // Reset the review/exec flow whenever the trade inputs change.
  useEffect(() => {
    setReviewCalls(null);
    setExecMessage(null);
  }, [amount, side, selected]);

  // Quote the swap on amount / pair change. Only runs with a connected address,
  // known token addresses, and a positive amount; errors fall back to AVNU and
  // otherwise surface as a hint.
  useEffect(() => {
    if (!isConnected || address === null) {
      setQuoteState({ status: "idle" });
      return;
    }
    if (spend.address === undefined || receive.address === undefined) {
      setQuoteState({ status: "error", message: "No route for this token yet." });
      return;
    }
    if (spend.address === receive.address) {
      setQuoteState({ status: "error", message: "Pick a token other than ETH." });
      return;
    }
    const sellAmount = toSmallestUnit(amount, spend.decimals!);
    if (sellAmount === null) {
      setQuoteState({ status: "idle" });
      return;
    }
    const sellToken = spend.address;
    const buyToken = receive.address;
    const receiveDecimals = receive.decimals!;
    let cancelled = false;
    setQuoteState({ status: "loading" });
    const handle = window.setTimeout(() => {
      const params = { sellToken, buyToken, sellAmount, takerAddress: address };
      void (async () => {
        try {
          let quote: SwapQuote;
          try {
            quote = await ekubo.quoteSwap(params);
          } catch {
            quote = await avnu.quoteSwap(params);
          }
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
    isConnected, address, amount, side, selected,
    spend.address, spend.decimals, receive.address, receive.decimals,
  ]);

  const onReview = useCallback(() => {
    if (quoteState.status !== "ready" || address === null) {
      return;
    }
    setExecMessage(null);
    try {
      const calls = ekubo.buildSwapCalls({ quote: quoteState.quote, takerAddress: address });
      setReviewCalls(calls);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not build the swap.";
      setExecMessage(message);
    }
  }, [quoteState, address]);

  const onConfirm = useCallback(() => {
    if (reviewCalls === null || account === null) {
      return;
    }
    setExecMessage("Submitting…");
    void (async () => {
      try {
        await account.execute([...reviewCalls]);
        setExecMessage("Submitted to wallet.");
        setReviewCalls(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Wallet rejected the swap.";
        setExecMessage(message);
      }
    })();
  }, [reviewCalls, account]);

  const chartFormat = useCallback(
    (v: number): string =>
      `$${v.toLocaleString(undefined, { maximumFractionDigits: token.priceNum < 1 ? 4 : 2 })}`,
    [token.priceNum],
  );

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
      <div className="pane3">
        {/* LEFT: token list */}
        <div className="leftlist">
          <TabStrip
            items={LEFT_TABS}
            value={leftTab}
            onChange={setLeftTab}
            style={{ padding: "0 4px" }}
          />
          <div className="listscroll">
            {SAMPLE_TOKENS.map((t, i) => (
              <div
                key={t.symbol}
                className={i === selected ? "tokrow sel" : "tokrow"}
                onClick={() => setSelected(i)}
              >
                <TokenIcon symbol={t.symbol} size={30} gradientIndex={i} />
                <div>
                  <div className="n1">{t.name}</div>
                  <div className="n2">{t.symbol}</div>
                </div>
                <div className="r">
                  <div className="pr mono">{t.price}</div>
                  <PctChange value={t.change} digits={1} className="ch" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CENTER: header + chart + trades */}
        <div className="center">
          <div className="tokhead">
            <div className="top">
              <TokenIcon symbol={token.symbol} size={40} gradientIndex={selected} />
              <div>
                <h2>
                  {token.name}{" "}
                  <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
                    {token.symbol}
                  </span>
                </h2>
                <div className="tiny">
                  Age {token.age} ·{" "}
                  <span style={{ color: "var(--text-2)" }}>{token.contract}</span>
                </div>
              </div>
              <button
                type="button"
                className="followbtn"
                style={{ marginLeft: 12 }}
                onClick={() => setFollowed((f) => !f)}
              >
                {followed ? "✓ Following" : "+ Follow"}
              </button>
              <div
                className="miniStats"
                style={{ marginLeft: "auto", border: "none", padding: 0, gap: 16 }}
              >
                <StatPair variant="mini" label="5m Vol" value={token.vol5m} />
                <StatPair variant="mini" label="Buys" value={token.buys} tone="pos" />
                <StatPair variant="mini" label="Sells" value={token.sells} tone="neg" />
              </div>
            </div>
            <div className="statgrid">
              <StatPair label="Price" value={token.price} />
              <StatPair label="Market Cap" value={token.marketCap} />
              <StatPair
                label="24h Change"
                value={<PctChange value={token.change} digits={2} />}
              />
              <StatPair label="Liquidity" value={token.liquidity} />
              <StatPair label="Supply" value={token.supply} />
              <StatPair label="Top 10" value={token.top10} />
              <StatPair
                label="Audit"
                value={token.audit}
                tone={token.audit === "Passed" ? "pos" : undefined}
              />
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
                <button
                  type="button"
                  className="tf"
                  style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
                >
                  Indicators
                </button>
              </div>
            </div>
            <CandlestickChart
              placeholder={{
                start: token.priceNum,
                vol: Math.max(token.priceNum * 0.015, 0.0001),
                up: token.change >= 0,
                format: chartFormat,
              }}
            />
          </div>

          <div className="tradetabs">
            <TabStrip items={TRADE_TABS} value={tradeTab} onChange={setTradeTab} />
            {tradeTab === "trades" ? (
              <table className="tt-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Type</th>
                    <th>Market Cap</th>
                    <th>Amount</th>
                    <th>Value</th>
                    <th>Wallet</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((tr, i) => (
                    <tr key={i}>
                      <td>{tr.time}</td>
                      <td
                        className={tr.buy ? "pos" : "neg"}
                        style={{ textAlign: "left", fontWeight: 700 }}
                      >
                        {tr.buy ? "Buy" : "Sell"}
                      </td>
                      <td className="mono">{tr.marketCap}</td>
                      <td className="mono">{tr.amount}</td>
                      <td className="mono">{tr.value}</td>
                      <td className="mono" style={{ color: "var(--text-3)" }}>
                        {tr.wallet}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                    gradientIndex={side === "buy" ? 1 : selected}
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
                  <span className="v">{quoteState.quote.protocol}</span>
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
                <span className="k">Top 10 H</span>
                <span className="v">{token.top10}</span>
              </div>
              <div className="ir">
                <span className="k">Dev H</span>
                <span className="v">2.1%</span>
              </div>
              <div className="ir">
                <span className="k">Snipers H</span>
                <span className="v">0.8%</span>
              </div>
              <div className="ir">
                <span className="k">Bundler H</span>
                <span className="v">1.4%</span>
              </div>
              <div className="ir">
                <span className="k">LP Burned</span>
                <span className="v pos">100%</span>
              </div>
              <div className="ir">
                <span className="k">Mintable</span>
                <span className="v pos">Disabled</span>
              </div>
              <div className="ir">
                <span className="k">Freezable</span>
                <span className="v pos">Disabled</span>
              </div>
              <div className="ir">
                <span className="k">Dev Wallet</span>
                <span className="v">{token.contract}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
