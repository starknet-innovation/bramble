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
import {
  Card,
  EmptyState,
  ErrorBanner,
  PctChange,
  RankRow,
  SegmentedTabs,
  SkeletonRows,
  TabStrip,
} from "../components";
import {
  formatCompactUsd,
  formatSignedUsd,
  formatUsd,
  usePerpsMarkets,
  usePortfolio,
  useTokens,
} from "../data";
import { useWallet } from "../wallet/WalletProvider";
import { dailyChangePct, fmtUsdPrice } from "./perps-data";

type TotalView = "total" | "tokens" | "perps";
type LeftTab = "positions" | "activities" | "follows";

const TOTAL_OPTIONS: readonly { value: TotalView; label: string }[] = [
  { value: "total", label: "Total" },
  { value: "tokens", label: "Tokens" },
  { value: "perps", label: "Perps" },
];

const LEFT_TABS: readonly { value: LeftTab; label: string }[] = [
  { value: "positions", label: "Positions" },
  { value: "activities", label: "Activities" },
  { value: "follows", label: "Follows" },
];

/** A dropdown-looking (non-functional, mockup-faithful) filter control. */
function DropButton({ label }: { readonly label: string }): ReactNode {
  return (
    <div className="dropbtn">
      {label} <span className="cx">&#9662;</span>
    </div>
  );
}

export default function Discover(): ReactNode {
  const { address, isConnected, isConnecting, connect } = useWallet();
  const [totalView, setTotalView] = useState<TotalView>("total");
  const [leftTab, setLeftTab] = useState<LeftTab>("positions");

  const { data: portfolio } = usePortfolio(address);
  const tokens = useTokens();
  const perps = usePerpsMarkets();

  const rankedTokens = useMemo(() => {
    const rows = [...(tokens.data ?? [])];
    return rows
      .sort((a, b) => (b.marketCapUsd ?? b.volume24hUsd ?? 0) - (a.marketCapUsd ?? a.volume24hUsd ?? 0))
      .slice(0, 20);
  }, [tokens.data]);

  // Real Extended perpetual markets, sorted by 24h volume (deepest first).
  const rankedPerps = useMemo(() => {
    return [...(perps.data ?? [])]
      .filter((m) => m.type === null || m.type === "PERPETUAL")
      .sort((a, b) => (b.marketStats?.dailyVolume ?? 0) - (a.marketStats?.dailyVolume ?? 0))
      .slice(0, 10);
  }, [perps.data]);

  const onConnect = (): void => {
    void connect();
  };

  // Total-panel figures reflect the real portfolio; perps has no source (0).
  const balance = !isConnected || totalView === "perps" ? 0 : portfolio.totalValueUsd;
  const pnl = !isConnected || totalView === "perps" ? 0 : portfolio.pnl24hUsd;

  const emptyForTab = (): ReactNode => {
    if (!isConnected) {
      return (
        <EmptyState
          icon={"\u{1F4B3}"}
          title="Connect your wallet"
          subtitle="Connect your wallet to see your positions and activity."
          ctaLabel="Connect Wallet"
          onCta={onConnect}
          ctaDisabled={isConnecting}
        />
      );
    }
    const labels: Record<LeftTab, { title: string; subtitle: string }> = {
      positions: { title: "No positions yet", subtitle: "Your open positions will appear here." },
      activities: { title: "No activity yet", subtitle: "Your recent trades and transfers will appear here." },
      follows: { title: "No follows yet", subtitle: "Wallets and tokens you follow will appear here." },
    };
    return <EmptyState icon={"\u{1F4B3}"} title={labels[leftTab].title} subtitle={labels[leftTab].subtitle} />;
  };

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
          <TabStrip<LeftTab> items={LEFT_TABS} value={leftTab} onChange={setLeftTab} />
          {emptyForTab()}
        </Card>
      </div>

      {/* ===== MID — Launches feed has no confirmed source: explicit empty state. ===== */}
      <Card
        className="dcol mid"
        title="Launches"
        headerExtra={
          <div style={{ marginLeft: 12 }}>
            <DropButton label="Migrated" />
          </div>
        }
        headerRight={<DropButton label="Trending" />}
      >
        <EmptyState
          icon="🚀"
          title="Launches — coming soon"
          subtitle="A verified meme-token launch feed isn't wired to a data source yet. No launches are shown rather than placeholder tokens."
          style={{ flex: 1 }}
        />
      </Card>

      {/* ===== RIGHT ===== */}
      <div className="dcol right">
        <Card
          title="Tokens"
          headerRight={<DropButton label="Market Cap" />}
          style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
        >
          <div className="listscroll">
            {tokens.error !== null && rankedTokens.length === 0 ? (
              <ErrorBanner message={`Couldn't load tokens: ${tokens.error}`} />
            ) : tokens.isLoading && rankedTokens.length === 0 ? (
              <SkeletonRows rows={6} />
            ) : rankedTokens.length === 0 ? (
              <EmptyState icon="🪙" title="No tokens available" style={{ minHeight: 160 }} />
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
                      name={token.name}
                      subLabel={token.symbol}
                      gradientIndex={index}
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
          headerRight={<DropButton label="Volume" />}
          style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
        >
          <div className="listscroll">
            {perps.error !== null && rankedPerps.length === 0 ? (
              <ErrorBanner message={`Couldn't load perps: ${perps.error}`} />
            ) : perps.isLoading && rankedPerps.length === 0 ? (
              <SkeletonRows rows={6} />
            ) : rankedPerps.length === 0 ? (
              <EmptyState icon="📊" title="No perp markets available" style={{ minHeight: 160 }} />
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
                        name={perp.name}
                        subLabel={
                          <span className="lev">{Math.max(1, Math.trunc(perp.maxLeverage))}x</span>
                        }
                        gradientIndex={index + 2}
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
