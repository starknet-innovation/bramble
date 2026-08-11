/**
 * Tokens screen — the three-pane token terminal. LEFT: a token list from the
 * real token universe (`useTokens` — Avnu market list, Ekubo fallback), click to
 * select. CENTER: the selected token's header + market stats (price / market cap
 * / liquidity / 24h volume / 24h change, all real from the token API + live
 * `usePrices`), a price chart fed by AVNU's contract-specific line history, and
 * a live spot tape from Ekubo's indexed pair events. RIGHT: an AVNU-inspired
 * swap ticket with a complete quote and wallet-review flow.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Check, Coins, LineChart, Plus } from "lucide-react";
import {
  CandlestickChart,
  EmptyState,
  ErrorBanner,
  PctChange,
  SkeletonChart,
  SkeletonRows,
  StatPair,
  TabStrip,
  TokenIcon,
} from "../../components/index";
import {
  formatCompactUsd,
  formatPrice,
  useCandles,
  useFollowedAssets,
  usePrices,
  useTokenTrades,
  useTokens,
  useWalletActivity,
  type TokenRow,
} from "../../data/index";
import { canonicalAddress } from "../../protocols/support/networks";
import { shortenAddress } from "../../shell/screens";
import type { ScreenId } from "../../shell/screens";
import { useWallet } from "../../wallet/connection/WalletProvider";
import { SwapPanel } from "../swap/SwapPanel";
import { TokenTradeTape } from "./TokenTradeTape";
import { TIMEFRAMES } from "./tokensData";

type LeftTab = "tokens" | "perps" | "follows";
type TradeTab = "trades" | "mine" | "positions" | "top" | "holders";

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

const priceLabel = (value: number | null): string => (value === null ? "—" : formatPrice(value));
const compactLabel = (value: number | null): string =>
  value === null ? "—" : formatCompactUsd(value);

type TokensProps = { readonly onNavigate: (screen: ScreenId) => void };

export default function Tokens({ onNavigate }: TokensProps): ReactNode {
  const { address, isConnected } = useWallet();

  const tokens = useTokens();
  const sourceList = useMemo<readonly TokenRow[]>(() => tokens.data ?? [], [tokens.data]);
  const prices = usePrices(sourceList.map((token) => token.address));
  const list = useMemo<readonly TokenRow[]>(
    () =>
      sourceList.map((token) => {
        const key = canonicalAddress(token.address);
        const live = key === null ? undefined : prices.data?.byAddress[key];
        return live === undefined
          ? token
          : {
              ...token,
              change24h: live.change24h ?? token.change24h,
              priceUsd: live.usd ?? token.priceUsd,
            };
      }),
    [prices.data, sourceList],
  );

  const [leftTab, setLeftTab] = useState<LeftTab>("tokens");
  const [tradeTab, setTradeTab] = useState<TradeTab>("trades");
  const [selected, setSelected] = useState(0);
  const [timeframe, setTimeframe] = useState("1d");
  const follows = useFollowedAssets();
  const followed = useMemo(
    () => new Set(follows.items.filter((item) => item.kind === "token").map((item) => item.id)),
    [follows.items],
  );

  const token: TokenRow | undefined = list[selected] ?? list[0];
  const trades = useTokenTrades(token ?? null, list);
  const walletActivity = useWalletActivity(address);
  const walletTransactionHashes = useMemo(() => {
    const hashes = new Set<string>();
    for (const item of walletActivity.data ?? []) {
      const hash = canonicalAddress(item.txHash);
      if (hash !== null) hashes.add(hash);
    }
    return hashes;
  }, [walletActivity.data]);
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
    follows.toggle({
      id: token.address,
      kind: "token",
      logoUri: token.logoUri,
      name: token.name,
      symbol: token.symbol,
    });
  };

  const priceUsd = token?.priceUsd ?? null;
  const change24h = token?.change24h ?? null;

  // Real AVNU line-price observations converted to interval candles.
  const candleAddress = token?.address ?? null;
  const candles = useCandles(candleAddress, timeframe, token?.symbol ?? null);

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
                  <TokenIcon
                    symbol={t.symbol}
                    logoUri={t.logoUri}
                    name={t.name}
                    size={30}
                    colorIndex={i}
                  />
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
              <TokenIcon
                symbol={token.symbol}
                logoUri={token.logoUri}
                name={token.name}
                size={40}
                colorIndex={selected}
              />
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
                aria-label={isFollowed ? "Following" : "Follow"}
                aria-pressed={isFollowed}
                type="button"
                className="followbtn"
                onClick={toggleFollow}
                title={isFollowed ? "Unfollow token" : "Follow token"}
              >
                {isFollowed ? (
                  <Check size={14} strokeWidth={2} aria-hidden />
                ) : (
                  <Plus size={14} strokeWidth={2} aria-hidden />
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
            {tradeTab === "trades" || tradeTab === "mine" ? (
              <TokenTradeTape
                connected={isConnected}
                mode={tradeTab}
                resource={trades}
                tokenSymbol={token.symbol}
                walletTransactionHashes={walletTransactionHashes}
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

        {/* RIGHT: swap panel */}
        <div className="rightpanel">
          <SwapPanel
            key={token.address}
            tokens={list}
            selectedToken={token}
          />
          <div className="token-facts">
            <div className="rp-title">Token info</div>
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
