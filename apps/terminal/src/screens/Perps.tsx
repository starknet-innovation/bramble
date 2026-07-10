/**
 * Perps screen — Extended perpetuals. Region-gated: a yellow banner sits atop a
 * 4-column layout (markets list · chart + trade tabs · order book · order
 * ticket). Markets come from `extended.fetchMarkets()` but fall back to local
 * samples when the region-locked API throws. The order CTA is inert because
 * `extended.signOrder` rejects (phase-2 off-chain signing), so placing an order
 * surfaces a disabled "not available in your region" state and never throws.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CandlestickChart,
  EmptyState,
  PctChange,
  SegmentedTabs,
  StatPair,
  TabStrip,
  TokenIcon,
} from "../components";
import { extended } from "../protocols";
import type { PerpOrderParams } from "../protocols";
import { useWallet } from "../wallet/WalletProvider";
import {
  SAMPLE_MARKETS,
  buildOrderBook,
  toPerpMarket,
  type OrderBookLevel,
  type PerpMarket,
} from "./perps-data";

type Side = "long" | "short";
type OrderType = "market" | "limit" | "stop";
type TradeTab = "positions" | "trades" | "funding" | "orders";
type BookTab = "book" | "trades";

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

const usd = (value: number): string =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Order-book price/size formatting scales with the market's magnitude.
const fmtPrice = (value: number): string => {
  const digits = value >= 1000 ? 1 : value >= 1 ? 3 : 5;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};
const fmtSize = (value: number): string => {
  const digits = value >= 1000 ? 0 : value >= 1 ? 2 : 3;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

const BookRow = ({ level, side }: { level: OrderBookLevel; side: Side }): ReactNode => (
  <div className={side === "long" ? "obrow bid" : "obrow ask"}>
    <span className="bar" style={{ width: `${level.depth}%` }} />
    <span className="px mono">{fmtPrice(level.price)}</span>
    <span className="sz mono">{fmtSize(level.size)}</span>
    <span className="tot mono">{fmtSize(level.total)}</span>
  </div>
);

export default function Perps(): ReactNode {
  const { address, account, isConnected, isConnecting, connect } = useWallet();

  const [markets, setMarkets] = useState<readonly PerpMarket[]>(SAMPLE_MARKETS);
  const [selected, setSelected] = useState<string>(SAMPLE_MARKETS[0]?.symbol ?? "");
  const [marketTab, setMarketTab] = useState<"markets" | "follows">("markets");
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [tradeTab, setTradeTab] = useState<TradeTab>("positions");
  const [bookTab, setBookTab] = useState<BookTab>("book");

  // Ticket state.
  const [side, setSide] = useState<Side>("long");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [usdAmount, setUsdAmount] = useState<string>("");
  const [sizePct, setSizePct] = useState<number>(0);
  const [leverage, setLeverage] = useState<number>(2);
  const [autoClose, setAutoClose] = useState<boolean>(false);
  const [placing, setPlacing] = useState<boolean>(false);
  const [orderBlocked, setOrderBlocked] = useState<boolean>(false);

  // Populate markets from the region-gated Extended API; keep samples on failure.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const fetched = await extended.fetchMarkets();
        if (!live || fetched.length === 0) {
          return;
        }
        setMarkets(fetched.map(toPerpMarket));
        setSelected((prev) => (fetched.some((m) => m.name === prev) ? prev : fetched[0]!.name));
      } catch {
        // Region-locked / transport failure: retain the local sample markets.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const market = useMemo(
    () => markets.find((m) => m.symbol === selected) ?? markets[0],
    [markets, selected],
  );

  const book = useMemo(
    () => (market === undefined ? undefined : buildOrderBook(market.symbol, market.markValue)),
    [market],
  );

  // Derived ticket figures.
  const notional = useMemo(() => {
    const usdIn = Number.parseFloat(usdAmount);
    return Number.isFinite(usdIn) ? usdIn * leverage : 0;
  }, [usdAmount, leverage]);
  const fees = notional * 0.0005;
  const liqPrice = useMemo(() => {
    if (market === undefined || notional <= 0 || leverage <= 0) {
      return undefined;
    }
    const factor = side === "long" ? 1 - 1 / leverage : 1 + 1 / leverage;
    return market.markValue * factor;
  }, [market, notional, leverage, side]);

  if (market === undefined) {
    return (
      <div className="screen" id="perps">
        <EmptyState icon="📊" title="No perp markets available" />
      </div>
    );
  }

  const maxLev = Math.max(1, market.maxLeverage);
  const boundedLev = Math.min(leverage, maxLev);

  const handlePlaceOrder = (): void => {
    if (!isConnected) {
      void connect();
      return;
    }
    if (account === null || address === null) {
      return;
    }
    // Extended settles off-chain and its signer is region-gated + phase-2 only,
    // so this attempt always rejects. Guard it: never let the click throw, and
    // fall into the disabled "not available in your region" state.
    setPlacing(true);
    const params: PerpOrderParams = {
      market: market.symbol,
      side: side === "long" ? "buy" : "sell",
      size: usdAmount === "" ? "0" : usdAmount,
      price: String(market.markValue),
      leverage: boundedLev,
      reduceOnly: false,
    };
    void extended
      .signOrder(params)
      .then(() => {
        setPlacing(false);
      })
      .catch(() => {
        setOrderBlocked(true);
        setPlacing(false);
      });
  };

  const ctaLabel = !isConnected
    ? "Connect Wallet"
    : orderBlocked
      ? "Signing not available in your region"
      : placing
        ? "Signing…"
        : `${side === "long" ? "Long" : "Short"} ${market.base}`;
  const ctaDisabled = isConnected && (orderBlocked || placing);

  return (
    <div className="screen" id="perps">
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div className="regionbanner">
          <span>&#9888;</span>
          <span>
            Access to this product isn't available in your region.{" "}
            <a href="#learn-more">Learn more.</a>
          </span>
        </div>

        <div className="perpscols">
          {/* LEFT — markets list */}
          <div className="leftlist">
            <TabStrip
              style={{ padding: "0 4px" }}
              items={[
                { value: "markets", label: "Markets" },
                { value: "follows", label: "Follows" },
              ]}
              value={marketTab}
              onChange={setMarketTab}
            />
            <div className="listscroll">
              {marketTab === "follows" ? (
                <EmptyState
                  icon="☆"
                  title="No followed markets"
                  subtitle="Follow a market to pin it here."
                  style={{ minHeight: 180 }}
                />
              ) : (
                markets.map((m) => (
                  <div
                    key={m.symbol}
                    className={m.symbol === selected ? "tokrow sel" : "tokrow"}
                    onClick={() => {
                      setSelected(m.symbol);
                      setOrderBlocked(false);
                    }}
                  >
                    <TokenIcon symbol={m.base} gradientIndex={m.gradientIndex} />
                    <div>
                      <div className="n1">{m.symbol}</div>
                      <div className="n2">
                        <span className="lev">{m.maxLeverage}x</span>
                      </div>
                    </div>
                    <div className="r">
                      <div className="pr mono">{m.price}</div>
                      <PctChange className="ch" value={m.change24h} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* CENTER — head + chart + trade tabs */}
          <div className="center">
            <div className="tokhead">
              <div className="top">
                <TokenIcon symbol={market.base} size={40} gradientIndex={market.gradientIndex} />
                <div>
                  <h2>
                    {market.symbol}{" "}
                    <span className="lev" style={{ fontSize: 11 }}>
                      {market.maxLeverage}x
                    </span>
                  </h2>
                  <div className="tiny">Perpetual · Extended</div>
                </div>
                <button type="button" className="followbtn" style={{ marginLeft: 12 }}>
                  + Follow
                </button>
              </div>
              <div className="statgrid">
                <StatPair label="Mark" value={market.mark} />
                <StatPair label="Oracle" value={market.oracle} />
                <StatPair
                  label="24h Change"
                  value={<PctChange value={market.change24h} />}
                  tone={market.change24h < 0 ? "neg" : "pos"}
                />
                <StatPair label="24h Volume" value={market.volume24h} />
                <StatPair
                  label="Funding"
                  value={`${market.funding >= 0 ? "+" : ""}${market.funding.toFixed(4)}%`}
                  tone={market.funding < 0 ? "neg" : "pos"}
                />
                <StatPair label="Open Interest" value={market.openInterest} />
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
                    Indicators
                  </button>
                </div>
              </div>
              <CandlestickChart
                key={market.symbol}
                placeholder={{
                  start: market.markValue,
                  vol: market.markValue * 0.0035,
                  up: market.change24h >= 0,
                  format: (v) => `$${fmtPrice(v)}`,
                }}
                height={320}
              />
            </div>

            <div className="tradetabs">
              <TabStrip
                style={{ padding: "0 16px" }}
                items={[
                  { value: "positions", label: "Positions" },
                  { value: "trades", label: "Trades" },
                  { value: "funding", label: "Funding" },
                  { value: "orders", label: "Order History" },
                ]}
                value={tradeTab}
                onChange={setTradeTab}
              />
              <EmptyState
                icon="📊"
                title={
                  tradeTab === "positions"
                    ? "No open positions"
                    : tradeTab === "trades"
                      ? "No trades yet"
                      : tradeTab === "funding"
                        ? "No funding payments"
                        : "No order history"
                }
                subtitle="Connect your wallet to start trading perps."
                ctaLabel={isConnected ? undefined : "Connect Wallet"}
                onCta={isConnected ? undefined : () => void connect()}
                ctaDisabled={isConnecting}
                style={{ minHeight: 150 }}
              />
            </div>
          </div>

          {/* ORDER BOOK */}
          <div className="obook">
            <div className="togg">
              <button
                type="button"
                className={bookTab === "book" ? "active" : undefined}
                onClick={() => setBookTab("book")}
              >
                Order Book
              </button>
              <button
                type="button"
                className={bookTab === "trades" ? "active" : undefined}
                onClick={() => setBookTab("trades")}
              >
                Trades
              </button>
            </div>
            {bookTab === "book" && book !== undefined ? (
              <>
                <div className="obcols">
                  <span>Price (USD)</span>
                  <span>Size ({market.base})</span>
                  <span>Total</span>
                </div>
                <div className="obscroll">
                  {book.asks.map((level) => (
                    <BookRow key={`ask-${level.price}`} level={level} side="short" />
                  ))}
                  <div className="obspread">
                    <span>Spread</span>
                    <span className="mono">
                      {fmtPrice(book.spread)} ({book.spreadPct.toFixed(2)}%)
                    </span>
                  </div>
                  {book.bids.map((level) => (
                    <BookRow key={`bid-${level.price}`} level={level} side="long" />
                  ))}
                </div>
              </>
            ) : (
              <EmptyState icon="🧾" title="No recent trades" style={{ minHeight: 180 }} />
            )}
          </div>

          {/* ORDER TICKET */}
          <div className="ticket">
            <div className="ti">
              <SegmentedTabs
                variant="seg"
                options={[
                  { value: "long", label: "Long", tone: "buy" },
                  { value: "short", label: "Short", tone: "sell" },
                ]}
                value={side}
                onChange={(v) => {
                  setSide(v);
                  setOrderBlocked(false);
                }}
              />
              <div className="otype">
                {(["market", "limit", "stop"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={orderType === t ? "active" : undefined}
                    onClick={() => setOrderType(t)}
                  >
                    {t === "market" ? "Market" : t === "limit" ? "Limit" : "Stop"}
                  </button>
                ))}
              </div>

              <div className="field-lbl">
                <span>Amount</span>
                <span>USD</span>
              </div>
              <div className="usdinput">
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={usdAmount}
                  onChange={(e) => {
                    setUsdAmount(e.target.value.replace(/[^0-9.]/g, ""));
                    setOrderBlocked(false);
                  }}
                />
                <span className="cur" style={{ fontWeight: 700, color: "var(--text-2)" }}>
                  USD
                </span>
              </div>

              <div className="field-lbl">
                <span>Size</span>
                <span>{sizePct}%</span>
              </div>
              <input
                type="range"
                className="slider"
                min={0}
                max={100}
                value={sizePct}
                onChange={(e) => setSizePct(Number(e.target.value))}
              />
              <div className="pctmarks">
                <span>0%</span>
                <span>25%</span>
                <span>50%</span>
                <span>75%</span>
                <span>100%</span>
              </div>

              <div className="field-lbl">
                <span>Leverage</span>
                <span>{boundedLev}x</span>
              </div>
              <input
                type="range"
                className="slider"
                min={1}
                max={maxLev}
                value={boundedLev}
                onChange={(e) => setLeverage(Number(e.target.value))}
              />
              <div className="pctmarks">
                <span>1x</span>
                <span>{Math.round(maxLev / 4)}x</span>
                <span>{Math.round(maxLev / 2)}x</span>
                <span>{maxLev}x</span>
              </div>

              <div className="infoblock" style={{ margin: "14px 0" }}>
                <div className="ir">
                  <span className="k">Liq. Price Est.</span>
                  <span className="v mono">
                    {liqPrice === undefined ? "—" : `$${fmtPrice(liqPrice)}`}
                  </span>
                </div>
                <div className="ir">
                  <span className="k">Order Value</span>
                  <span className="v mono">{usd(notional)}</span>
                </div>
                <div className="ir">
                  <span className="k">Fees</span>
                  <span className="v mono">{usd(fees)}</span>
                </div>
              </div>

              <div className="togglerow">
                <span>Auto-Close</span>
                <button
                  type="button"
                  aria-pressed={autoClose}
                  className="switch"
                  onClick={() => setAutoClose((v) => !v)}
                  style={
                    autoClose
                      ? { background: "var(--accent)", border: "none", padding: 0 }
                      : { border: "none", padding: 0 }
                  }
                />
              </div>

              <button
                type="button"
                className="bigcta"
                style={{ marginTop: 8, opacity: ctaDisabled ? 0.6 : 1 }}
                disabled={ctaDisabled}
                onClick={handlePlaceOrder}
              >
                {ctaLabel}
              </button>

              <div className="balrow">
                <span className="k">Total Balance</span>
                <span className="mono">{usd(0)}</span>
              </div>
              <div className="balrow">
                <span className="k">Available</span>
                <span className="mono">{usd(0)}</span>
              </div>
              <div className="dwbtns">
                <button type="button">Deposit</button>
                <button type="button">Withdraw</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
