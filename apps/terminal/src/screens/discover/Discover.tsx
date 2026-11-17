/**
 * Discover screen — the terminal landing view. Three columns:
 *  - LEFT: a Total balance/P&L panel (real, from `usePortfolio` once connected)
 *    + a Positions/Activities/Follows card whose body is a wallet-aware
 *    EmptyState.
 *  - MID: the "Launches" feed — a meme-token launch feed with NO confirmed data
 *    source, so it renders an explicit "coming soon" empty state (not fake rows).
 *  - RIGHT: ranked "Tokens" (real, from `useTokens`, sorted by market cap) and
 *    "Perps" (real, from `usePerpsMarkets`, sorted by 24h volume).
 */
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Activity, Box, ChartCandlestick, Coins } from "lucide-react";
import {
  Card,
  EmptyState,
  ErrorBanner,
  PctChange,
  RankRow,
  SegmentedTabs,
  SkeletonRows,
} from "../../components/index";
import {
  formatCompactUsd,
  formatSignedUsd,
  formatUsd,
  useChainPulse,
  usePerpsMarkets,
  usePortfolio,
  useTokens,
} from "../../data/index";
import { extendedTokenLogo } from "../../assets/extended-token-assets";
import type { ScreenId } from "../../shell/screens";
import { useWallet } from "../../wallet/connection/WalletProvider";
import { ChainActivityFeed } from "../activity/ChainActivityFeed";
import { DiscoverWalletPanel } from "./DiscoverWalletPanel";
import { collapseDiscoverTokenRepresentations } from "./discover-data";
import { dailyChangePct, fmtUsdPrice } from "../perps/perps-data";
import { loadFailedMessage } from "../../protocols/support/user-error";

type TotalView = "total" | "tokens" | "perps";
type TokenSort = "marketCap" | "volume" | "change";
type PerpSort = "volume" | "change";

const TOTAL_OPTIONS: readonly { value: TotalView; label: string }[] = [
  { value: "total", label: "Total" },
  { value: "tokens", label: "Tokens" },
  { value: "perps", label: "Perps" },
];

type DiscoverProps = { readonly onNavigate: (screen: ScreenId) => void };

export default function Discover({ onNavigate }: DiscoverProps): ReactNode {
  const { address, isConnected, isConnecting, connect } = useWallet();
  const [totalView, setTotalView] = useState<TotalView>("total");
  const [tokenSort, setTokenSort] = useState<TokenSort>("marketCap");
  const [perpSort, setPerpSort] = useState<PerpSort>("volume");

  const { data: portfolio } = usePortfolio(address);
  const tokens = useTokens();
  const perps = usePerpsMarkets();
  const chain = useChainPulse();
  const headBlock = chain.data?.blocks[0] ?? null;

  const rankedTokens = useMemo(() => {
    const rows = [...collapseDiscoverTokenRepresentations(tokens.data ?? [])];
    return rows.sort((a, b) => {
      if (tokenSort === "volume") {
        return (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0);
      }
      if (tokenSort === "change") {
        return (b.change24h ?? Number.NEGATIVE_INFINITY) - (a.change24h ?? Number.NEGATIVE_INFINITY);
      }
      return (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0);
    }).slice(0, 20);
  }, [tokenSort, tokens.data]);

  // Real Extended perpetual markets, sorted by 24h volume (deepest first).
  const rankedPerps = useMemo(() => {
    return [...(perps.data ?? [])]
      .filter((m) => m.type === null || m.type === "PERPETUAL")
      .sort((a, b) =>
        perpSort === "change"
          ? dailyChangePct(b.marketStats) - dailyChangePct(a.marketStats)
          : (b.marketStats?.dailyVolume ?? 0) - (a.marketStats?.dailyVolume ?? 0),
      )
      .slice(0, 10);
  }, [perpSort, perps.data]);

  const onConnect = (): void => {
    void connect();
  };

  // Total-panel figures reflect the real portfolio; perps has no source (0).
  const balance = !isConnected || totalView === "perps" ? 0 : portfolio.totalValueUsd;
  const pnl = !isConnected || totalView === "perps" ? 0 : portfolio.pnl24hUsd;

  return (
    <div className="screen" id="discover">
      {/* ===== LEFT ===== */}
      <div className="dcol left">
        <Card className="totalpanel" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Total</div>
            <SegmentedTabs<TotalView>
              options={TOTAL_OPTIONS}
              value={totalView}
              onChange={setTotalView}
              variant="subtabs"
            />
          </div>
          <div className="totalrow">
            <div>
              <div className="lbl">Balance</div>
              <div className="val mono">{formatUsd(balance)}</div>
            </div>
            <div>
              <div className="lbl">P&amp;L</div>
              <div className={`val small mono ${pnl < 0 ? "neg" : "pos"}`}>
                {formatSignedUsd(pnl)}
              </div>
            </div>
          </div>
        </Card>

        <Card style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <DiscoverWalletPanel
            address={address}
            isConnected={isConnected}
            isConnecting={isConnecting}
            onConnect={onConnect}
            onNavigate={onNavigate}
          />
        </Card>
      </div>

      {/* ===== MID — live, indexed Starknet activity. ===== */}
      <Card
        className="dcol mid"
        title="Starknet live"
        headerExtra={
          headBlock === null ? undefined : (
            <span className="chain-head mono">
              <Box size={12} aria-hidden="true" />
              {headBlock.blockNumber.toLocaleString("en-US")}
            </span>
          )
        }
        headerRight={
          <span className={`chain-status ${chain.error === null ? "online" : ""}`}>
            <span className="chain-status-dot" aria-hidden="true" />
            {chain.error === null ? "Live" : "Reconnecting"}
          </span>
        }
      >
        {chain.error !== null && chain.data === null ? (
          <ErrorBanner message="Starknet activity is reconnecting. The feed will resume automatically." />
        ) : chain.isLoading && chain.data === null ? (
          <SkeletonRows rows={8} />
        ) : chain.data === null ||
          (chain.data.blocks.length === 0 &&
            chain.data.transactions.length === 0 &&
            chain.data.events.length === 0 &&
            chain.data.messages.length === 0) ? (
          <EmptyState
            icon={<Activity size={22} strokeWidth={1.75} />}
            title="Waiting for chain activity"
            subtitle="Blocks, transactions, events, and bridge messages will stream in as Starknet indexes them."
            style={{ flex: 1 }}
          />
        ) : (
          <ChainActivityFeed pulse={chain.data} />
        )}
      </Card>

      {/* ===== RIGHT ===== */}
      <div className="dcol right">
        <Card
          title="Tokens"
          headerRight={
            <select
              className="compact-select"
              aria-label="Sort tokens"
              value={tokenSort}
              onChange={(event) => setTokenSort(event.target.value as TokenSort)}
            >
              <option value="marketCap">Market Cap</option>
              <option value="volume">Volume</option>
              <option value="change">24h Change</option>
            </select>
          }
          style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
        >
          <div className="listscroll">
            {tokens.error !== null && rankedTokens.length === 0 ? (
              <ErrorBanner message={loadFailedMessage("tokens", tokens.error)} />
            ) : tokens.isLoading && rankedTokens.length === 0 ? (
              <SkeletonRows rows={6} />
            ) : rankedTokens.length === 0 ? (
              <EmptyState
                icon={<Coins size={22} strokeWidth={1.75} />}
                title="No tokens available"
                style={{ minHeight: 160 }}
              />
            ) : (
              <table className="ranktable">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Token</th>
                    <th>Market Cap</th>
                    <th>24h</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedTokens.map((token, index) => (
                    <RankRow
                      key={token.address}
                      rank={index + 1}
                      symbol={token.symbol}
                      logoUri={token.logoUri}
                      name={token.name}
                      subLabel={token.symbol}
                      colorIndex={index}
                      cells={[
                        token.marketCapUsd === null ? "—" : formatCompactUsd(token.marketCapUsd),
                        token.change24h === null ? (
                          "—"
                        ) : (
                          <PctChange key="ch" value={token.change24h} digits={1} />
                        ),
                      ]}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        {/* Perps ranked column — real Extended markets, sorted by 24h volume. */}
        <Card
          title="Perps"
          headerRight={
            <select
              className="compact-select"
              aria-label="Sort perps"
              value={perpSort}
              onChange={(event) => setPerpSort(event.target.value as PerpSort)}
            >
              <option value="volume">Volume</option>
              <option value="change">24h Change</option>
            </select>
          }
          style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
        >
          <div className="listscroll">
            {perps.error !== null && rankedPerps.length === 0 ? (
              <ErrorBanner message={loadFailedMessage("perps", perps.error)} />
            ) : perps.isLoading && rankedPerps.length === 0 ? (
              <SkeletonRows rows={6} />
            ) : rankedPerps.length === 0 ? (
              <EmptyState
                icon={<ChartCandlestick size={22} strokeWidth={1.75} />}
                title="No perp markets available"
                style={{ minHeight: 160 }}
              />
            ) : (
              <table className="ranktable">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Symbol</th>
                    <th>Price</th>
                    <th>24h</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedPerps.map((perp, index) => {
                    const stats = perp.marketStats;
                    const price = stats !== null ? stats.lastPrice || stats.markPrice : 0;
                    return (
                      <RankRow
                        key={perp.name}
                        rank={index + 1}
                        symbol={perp.assetName}
                        logoUri={extendedTokenLogo(perp.assetName)}
                        name={perp.name}
                        subLabel={
                          <span className="lev">{Math.max(1, Math.trunc(perp.maxLeverage))}x</span>
                        }
                        colorIndex={index + 2}
                        cells={[
                          fmtUsdPrice(price),
                          <PctChange key="ch" value={dailyChangePct(stats)} digits={1} />,
                        ]}
                      />
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
