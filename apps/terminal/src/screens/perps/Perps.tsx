/**
 * Perps screen — Extended (x10) perpetuals, wired end-to-end to LIVE public
 * market data via the Extended REST + WS data layer:
 *   - markets list + per-market stats  -> usePerpsMarkets / usePerpsMarketStats
 *   - candlestick chart                -> usePerpsCandles (real o/h/l/c/T candles)
 *   - order book (red asks/green bids) -> useOrderBook (REST snapshot + live WS)
 *   - trade tape                       -> usePerpsTrades (WS publicTrades)
 *   - funding history + mark/index/OI  -> useFunding / market stats
 *
 * The order-placement ticket stays intentionally gated: signing is stubbed and
 * placement is region-locked, so the CTA is visible but disabled with a clear
 * reason. ALL market data on the surface is live (no sample/mock rows remain).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Banknote,
  BarChart3,
  BookOpen,
  ChartCandlestick,
  Check,
  LineChart,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Receipt,
  Star,
  TriangleAlert,
} from "lucide-react";
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
} from "../../components/index";
import {
  TIMEFRAME_TO_INTERVAL,
  useFunding,
  useOrderBook,
  usePerpsCandles,
  usePerpsMarketStats,
  usePerpsMarkets,
  usePerpsTrades,
  useFollowedAssets,
  type ExtendedMarketStats,
  type ExtendedPublicTrade,
} from "../../data/index";
import { extendedTokenLogo } from "../../assets/extended-token-assets";
import { useWallet } from "../../wallet/connection/WalletProvider";
import {
  buildOrderBookView,
  dailyChangePct,
  fmtCompactUsd,
  fmtPrice,
  fmtSize,
  fmtUsdPrice,
  fundingPct,
  toMarketRow,
  type OrderBookLevel,
} from "./perps-data";

type Side = "long" | "short";
type OrderType = "market" | "limit" | "stop";
type TradeTab = "positions" | "trades" | "funding" | "orders";

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];
const ORDER_BOOK_ROWS = 14;

// Order placement is stubbed (no signer) and region-locked; surfaced verbatim.
const ORDER_DISABLED_REASON =
  "Order placement requires a signed session and isn't available in your region.";

const usd = (value: number): string =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const BookRow = ({ level, side }: { level: OrderBookLevel; side: Side }): ReactNode => (
  <div className={side === "long" ? "obrow bid" : "obrow ask"}>
    <span className="bar" style={{ width: `${level.depth}%` }} />
    <span className="px mono">{fmtPrice(level.price)}</span>
    <span className="sz mono">{fmtSize(level.size)}</span>
    <span className="tot mono">{fmtSize(level.total)}</span>
  </div>
);

// The live public-trades tape, shared by the center "Trades" tab and the order
// book's "Trades" toggle. Renders a clean empty state (never fabricated rows)
// when the WS stream has not delivered any trades.
const TradeTape = ({
  trades,
  isLoading,
  error,
}: {
  trades: readonly ExtendedPublicTrade[];
  isLoading: boolean;
  error: string | null;
}): ReactNode => {
  if (error !== null && trades.length === 0) {
    return <ErrorBanner message={`Couldn't load trades: ${error}`} />;
  }
  if (isLoading && trades.length === 0) {
    return <SkeletonRows rows={8} />;
  }
  if (trades.length === 0) {
    return (
      <EmptyState
        icon={<Receipt size={22} strokeWidth={1.75} />}
        title="No recent trades"
        subtitle="Live trades will appear here as they print."
        style={{ minHeight: 180 }}
      />
    );
  }
  return (
    <div className="obscroll">
      <div className="obcols">
        <span>Price</span>
        <span>Size</span>
        <span>Time</span>
      </div>
      {trades.map((trade) => (
        <div
          key={trade.id}
          className={trade.side === "BUY" ? "obrow bid" : "obrow ask"}
          style={{ zIndex: 1 }}
        >
          <span className="px mono">{fmtPrice(trade.price)}</span>
          <span className="sz mono">{fmtSize(trade.qty)}</span>
          <span className="tot mono">
            {new Date(trade.timestamp).toLocaleTimeString("en-US", { hour12: false })}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function Perps(): ReactNode {
  const { isConnected, isConnecting, connect } = useWallet();

  const markets = usePerpsMarkets();
  const [selected, setSelected] = useState<string>("");
  const [marketTab, setMarketTab] = useState<"markets" | "follows">("markets");
  const follows = useFollowedAssets();
  const followed = useMemo(
    () => new Set(follows.items.filter((item) => item.kind === "perp").map((item) => item.id)),
    [follows.items],
  );
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [tradeTab, setTradeTab] = useState<TradeTab>("trades");
  const [isMarketRailOpen, setIsMarketRailOpen] = useState(true);

  // Ticket state (visual only — placement is gated below).
  const [side, setSide] = useState<Side>("long");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [usdAmount, setUsdAmount] = useState<string>("");
  const [sizePct, setSizePct] = useState<number>(0);
  const [leverage, setLeverage] = useState<number>(2);
  const [autoClose, setAutoClose] = useState<boolean>(false);

  // Perpetual markets only (SPOT filtered when the API exposes `type`), sorted
  // by 24h volume descending so the deepest markets lead the list.
  const rows = useMemo(() => {
    const source = markets.data ?? [];
    return source
      .filter((m) => m.type === null || m.type === "PERPETUAL")
      .map((m, index) => toMarketRow(m, index))
      .sort((a, b) => b.volume24hUsd - a.volume24hUsd);
  }, [markets.data]);

  // Keep the selection valid as markets load / change.
  useEffect(() => {
    if (rows.length === 0) {
      return;
    }
    setSelected((prev) => (rows.some((r) => r.symbol === prev) ? prev : rows[0]!.symbol));
  }, [rows]);

  const selectedRow = useMemo(
    () => rows.find((r) => r.symbol === selected) ?? rows[0],
    [rows, selected],
  );
  const activeSymbol = selectedRow?.symbol ?? null;

  // Live per-market data for the selected market.
  const statsResource = usePerpsMarketStats(activeSymbol);
  const orderBook = useOrderBook(activeSymbol);
  const trades = usePerpsTrades(activeSymbol);
  const funding = useFunding(activeSymbol);
  const candles = usePerpsCandles(activeSymbol, "trades", TIMEFRAME_TO_INTERVAL[timeframe]!);

  // Resource<T> types `data` as `T | null`; these hooks always seed a non-null
  // value, so coalesce once here for ergonomic use below.
  const tradesData = trades.data ?? [];
  const candlesData = candles.data ?? [];
  const fundingData = funding.data ?? { latest: null, history: [] };

  // Prefer the fresher standalone stats call; fall back to the nested stats the
  // markets list already carries so the header is populated immediately.
  const stats: ExtendedMarketStats | null = useMemo(() => {
    if (statsResource.data !== null) {
      return statsResource.data;
    }
    const market = (markets.data ?? []).find((m) => m.name === activeSymbol);
    return market?.marketStats ?? null;
  }, [statsResource.data, markets.data, activeSymbol]);

  const book = useMemo(
    () => buildOrderBookView(orderBook.data, ORDER_BOOK_ROWS),
    [orderBook.data],
  );
  const isFollowed = activeSymbol !== null && followed.has(activeSymbol);

  const toggleFollow = (): void => {
    if (activeSymbol === null || selectedRow === undefined) {
      return;
    }
    follows.toggle({
      id: activeSymbol,
      kind: "perp",
      logoUri: extendedTokenLogo(selectedRow.base),
      name: activeSymbol,
      symbol: selectedRow.base,
    });
  };

  const markValue =
    stats !== null ? stats.markPrice || stats.lastPrice : (selectedRow?.markValue ?? 0);

  // Derived ticket figures (display only).
  const maxLev = Math.max(1, selectedRow?.maxLeverage ?? 1);
  const boundedLev = Math.min(leverage, maxLev);
  const notional = useMemo(() => {
    const usdIn = Number.parseFloat(usdAmount);
    return Number.isFinite(usdIn) ? usdIn * boundedLev : 0;
  }, [usdAmount, boundedLev]);
  const fees = notional * 0.0005;
  const liqPrice = useMemo(() => {
    if (markValue <= 0 || notional <= 0 || boundedLev <= 0) {
      return undefined;
    }
    const factor = side === "long" ? 1 - 1 / boundedLev : 1 + 1 / boundedLev;
    return markValue * factor;
  }, [markValue, notional, boundedLev, side]);

  const changePct = dailyChangePct(stats);
  const fundingRate = fundingData.latest?.fundingRate ?? stats?.fundingRate ?? 0;

  // ----- markets list body (skeleton / error / empty / rows) -----
  const marketsBody = (): ReactNode => {
    const visibleRows = marketTab === "follows" ? rows.filter((row) => followed.has(row.symbol)) : rows;
    if (marketTab === "follows" && visibleRows.length === 0) {
      return (
        <EmptyState
          icon={<Star size={22} strokeWidth={1.75} />}
          title="No followed markets"
          subtitle="Follow a market to pin it here."
          style={{ minHeight: 180 }}
        />
      );
    }
    if (markets.error !== null && rows.length === 0) {
      return <ErrorBanner message={`Couldn't load markets: ${markets.error}`} />;
    }
    if (markets.isLoading && rows.length === 0) {
      return <SkeletonRows rows={8} />;
    }
    if (rows.length === 0) {
      return (
        <EmptyState
          icon={<ChartCandlestick size={22} strokeWidth={1.75} />}
          title="No perp markets available"
          style={{ minHeight: 180 }}
        />
      );
    }
    return visibleRows.map((m) => (
      <button
        type="button"
        key={m.symbol}
        className={m.symbol === selected ? "tokrow sel" : "tokrow"}
        onClick={() => setSelected(m.symbol)}
      >
        <TokenIcon
          symbol={m.base}
          logoUri={extendedTokenLogo(m.base)}
          name={m.base}
          colorIndex={m.colorIndex}
        />
        <div>
          <div className="n1">{m.symbol}</div>
          <div className="n2">
            <span className="lev">{m.maxLeverage}x</span>
          </div>
        </div>
        <div className="r">
          <div className="pr mono">{m.priceLabel}</div>
          <PctChange className="ch" value={m.change24h} />
        </div>
      </button>
    ));
  };

  // ----- chart body -----
  const chartBody = (): ReactNode => {
    if (candlesData.length > 0) {
      return <CandlestickChart key={activeSymbol ?? "none"} data={candlesData} height={320} />;
    }
    if (candles.isLoading) {
      return <SkeletonChart height={320} />;
    }
    if (candles.error !== null) {
      return <ErrorBanner message={`Couldn't load candles: ${candles.error}`} />;
    }
    return (
      <EmptyState
        icon={<LineChart size={22} strokeWidth={1.75} />}
        title="No chart data"
        style={{ minHeight: 320 }}
      />
    );
  };

  // ----- center trade tabs body -----
  const tradeTabBody = (): ReactNode => {
    if (tradeTab === "trades") {
      return (
        <TradeTape trades={tradesData} isLoading={trades.isLoading} error={trades.error} />
      );
    }
    if (tradeTab === "funding") {
      if (funding.error !== null && fundingData.history.length === 0) {
        return <ErrorBanner message={`Couldn't load funding: ${funding.error}`} />;
      }
      if (funding.isLoading && fundingData.history.length === 0) {
        return <SkeletonRows rows={6} />;
      }
      if (fundingData.history.length === 0) {
        return (
          <EmptyState
            icon={<Banknote size={22} strokeWidth={1.75} />}
            title="No funding history"
            style={{ minHeight: 150 }}
          />
        );
      }
      const recent = [...fundingData.history].reverse().slice(0, 24);
      return (
        <div className="listscroll" style={{ padding: "6px 16px" }}>
          {recent.map((entry) => (
            <div
              key={entry.timestamp}
              style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}
            >
              <span className="mono" style={{ color: "var(--text-2)" }}>
                {new Date(entry.timestamp).toLocaleString("en-US")}
              </span>
              <PctChange value={fundingPct(entry.fundingRate)} digits={4} />
            </div>
          ))}
        </div>
      );
    }
    // positions / orders are account-gated.
    return (
      <EmptyState
        icon={<BarChart3 size={22} strokeWidth={1.75} />}
        title={tradeTab === "positions" ? "No open positions" : "No order history"}
        subtitle="Connect your wallet to start trading perps."
        ctaLabel={isConnected ? undefined : "Connect Wallet"}
        onCta={isConnected ? undefined : () => void connect()}
        ctaDisabled={isConnecting}
        style={{ minHeight: 150 }}
      />
    );
  };

  return (
    <div className="screen" id="perps">
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div className="regionbanner">
          <TriangleAlert size={14} strokeWidth={2} style={{ flexShrink: 0 }} aria-hidden />
          <span>
            Market data is live. Order placement requires a signed session and isn&apos;t available
            in your region.
          </span>
        </div>

        <div className={isMarketRailOpen ? "perpscols" : "perpscols rail-collapsed"}>
          {/* LEFT — markets list */}
          <div className={isMarketRailOpen ? "leftlist perps-market-rail" : "leftlist perps-market-rail collapsed"}>
            <div className="perps-market-rail-head">
              {isMarketRailOpen ? (
                <TabStrip
                  items={[
                    { value: "markets", label: "Markets" },
                    { value: "follows", label: "Follows" },
                  ]}
                  value={marketTab}
                  onChange={setMarketTab}
                />
              ) : null}
              <button
                aria-label={isMarketRailOpen ? "Collapse markets" : "Expand markets"}
                className="perps-rail-toggle"
                onClick={() => setIsMarketRailOpen((current) => !current)}
                title={isMarketRailOpen ? "Collapse markets" : "Expand markets"}
                type="button"
              >
                {isMarketRailOpen ? (
                  <PanelLeftClose size={15} aria-hidden />
                ) : (
                  <PanelLeftOpen size={15} aria-hidden />
                )}
              </button>
            </div>
            {isMarketRailOpen ? <div className="listscroll">{marketsBody()}</div> : null}
          </div>

          {/* CENTER — head + chart + trade tabs */}
          <div className="center">
            <div className="tokhead">
              <div className="top">
                <TokenIcon
                  symbol={selectedRow?.base ?? "?"}
                  logoUri={extendedTokenLogo(selectedRow?.base ?? "")}
                  name={selectedRow?.base}
                  size={40}
                  colorIndex={selectedRow?.colorIndex ?? 0}
                />
                <div>
                  <h2>
                    {selectedRow?.symbol ?? "—"}{" "}
                    <span className="lev" style={{ fontSize: 11 }}>
                      {selectedRow?.maxLeverage ?? 1}x
                    </span>
                  </h2>
                  <div className="tiny">Perpetual · Extended</div>
                </div>
                <button
                  aria-label={isFollowed ? "Following" : "Follow"}
                  aria-pressed={isFollowed}
                  className="followbtn"
                  onClick={toggleFollow}
                  title={isFollowed ? "Unfollow market" : "Follow market"}
                  type="button"
                >
                  {isFollowed ? (
                    <Check size={14} strokeWidth={2} aria-hidden />
                  ) : (
                    <Plus size={14} strokeWidth={2} aria-hidden />
                  )}
                </button>
              </div>
              <div className="statgrid">
                <StatPair label="Mark" value={fmtUsdPrice(stats?.markPrice ?? markValue)} />
                <StatPair label="Index" value={fmtUsdPrice(stats?.indexPrice ?? markValue)} />
                <StatPair
                  label="24h Change"
                  value={<PctChange value={changePct} />}
                  tone={changePct < 0 ? "neg" : "pos"}
                />
                <StatPair
                  label="Funding"
                  value={`${fundingRate >= 0 ? "+" : ""}${fundingPct(fundingRate).toFixed(4)}%`}
                  tone={fundingRate < 0 ? "neg" : "pos"}
                />
                <StatPair
                  label="Open Interest"
                  value={stats !== null ? fmtCompactUsd(stats.openInterest) : "—"}
                />
              </div>
            </div>

            <div className="chartwrap">
              {chartBody()}
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
              </div>
            </div>
          </div>

          {/* ORDER BOOK */}
          <div className="obook">
            <header className="obook-title">
              <strong>Order book</strong>
              <span><i aria-hidden /> Live</span>
            </header>
            {book !== null ? (
              <>
                <div className="obcols">
                  <span>Price (USD)</span>
                  <span>Size ({selectedRow?.base ?? ""})</span>
                  <span>Total</span>
                </div>
                <div className="obscroll orderbook-scroll">
                  <div className="obside asks">
                    {book.asks.map((level) => (
                      <BookRow key={`ask-${level.price}`} level={level} side="short" />
                    ))}
                  </div>
                  <div className="obspread">
                    <span className="obspread-price mono">{fmtPrice(book.midPrice)}</span>
                    <span className="obspread-meta">
                      <span>Spread</span>
                      <span className="mono">
                        {fmtPrice(book.spread)} · {book.spreadPct.toFixed(2)}%
                      </span>
                    </span>
                  </div>
                  <div className="obside bids">
                    {book.bids.map((level) => (
                      <BookRow key={`bid-${level.price}`} level={level} side="long" />
                    ))}
                  </div>
                </div>
              </>
            ) : orderBook.error !== null ? (
              <ErrorBanner message={`Couldn't load order book: ${orderBook.error}`} />
            ) : orderBook.isLoading ? (
              <div className="orderbook-loading">
                <SkeletonRows rows={10} />
              </div>
            ) : (
              <EmptyState
                icon={<BookOpen size={22} strokeWidth={1.75} />}
                title="No order book"
                style={{ minHeight: 180 }}
              />
            )}
          </div>

          {/* ORDER TICKET — visible but gated (signing stubbed + region-locked). */}
          <div className="ticket">
            <div className="ti">
              <SegmentedTabs
                variant="seg"
                options={[
                  { value: "long", label: "Long", tone: "buy" },
                  { value: "short", label: "Short", tone: "sell" },
                ]}
                value={side}
                onChange={setSide}
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
                  onChange={(e) => setUsdAmount(e.target.value.replace(/[^0-9.]/g, ""))}
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

              {isConnected ? (
                <>
                  <button
                    type="button"
                    className="bigcta"
                    style={{ marginTop: 8, opacity: 0.6 }}
                    disabled
                    aria-disabled="true"
                    title={ORDER_DISABLED_REASON}
                  >
                    Order Placement Unavailable
                  </button>
                  <div
                    role="note"
                    className="tiny"
                    style={{ marginTop: 8, color: "var(--text-3)", lineHeight: 1.4 }}
                  >
                    {ORDER_DISABLED_REASON}
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="bigcta"
                  style={{ marginTop: 8, opacity: isConnecting ? 0.6 : 1 }}
                  disabled={isConnecting}
                  onClick={() => void connect()}
                >
                  {isConnecting ? "Connecting…" : "Connect Wallet"}
                </button>
              )}

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

          <section className="tradetabs" aria-label="Perpetual account activity">
            <TabStrip
              items={[
                { value: "positions", label: "Positions" },
                { value: "trades", label: "Trades" },
                { value: "funding", label: "Funding" },
                { value: "orders", label: "Order History" },
              ]}
              value={tradeTab}
              onChange={setTradeTab}
            />
            {tradeTabBody()}
          </section>
        </div>
      </div>
    </div>
  );
}
