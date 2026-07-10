/**
 * Discover screen — the terminal landing view. Three columns:
 *  - LEFT: a Total balance/P&L panel + a Positions/Activities/Follows card whose
 *    body is a wallet-aware EmptyState.
 *  - MID: the "Launches" feed (scrollable meme-token launch rows).
 *  - RIGHT: ranked "Tokens" and "Perps" tables.
 *
 * All figures are screen-local hardcoded Starknet-flavored sample data (see
 * ./discoverData). No protocol calls are made here — Discover is a browse
 * surface; trading happens on the Tokens/Perps screens.
 */
import type { ReactNode } from "react";
import { useState } from "react";
import {
  Card,
  EmptyState,
  PctChange,
  RankRow,
  SegmentedTabs,
  TabStrip,
  TokenIcon,
} from "../components";
import { useWallet } from "../wallet/WalletProvider";
import { LAUNCHES, RANKED_PERPS, RANKED_TOKENS } from "./discoverData";

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
  const { isConnected, isConnecting, connect } = useWallet();
  const [totalView, setTotalView] = useState<TotalView>("total");
  const [leftTab, setLeftTab] = useState<LeftTab>("positions");

  const onConnect = (): void => {
    void connect();
  };

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
              <div className="val mono">$0.00</div>
            </div>
            <div>
              <div className="lbl">P&amp;L</div>
              <div className="val small pos mono">+$0.00</div>
            </div>
          </div>
        </Card>

        <Card style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <TabStrip<LeftTab> items={LEFT_TABS} value={leftTab} onChange={setLeftTab} />
          {emptyForTab()}
        </Card>
      </div>

      {/* ===== MID ===== */}
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
        <div className="listscroll">
          {LAUNCHES.map((launch, index) => (
            <div className="launchrow" key={launch.ticker}>
              <TokenIcon symbol={launch.ticker} size={38} gradientIndex={index} />
              <div className="mid2">
                <div className="nm">
                  {launch.name}{" "}
                  <span className="muted" style={{ fontWeight: 600, fontSize: 11 }}>
                    {launch.ticker}
                  </span>
                </div>
                <div className="sub">
                  <span>{launch.age}</span>
                  <span>&middot;</span>
                  <span>{launch.txCount} tx</span>
                </div>
                <div className="pillrow">
                  {launch.pills.map((pill) => (
                    <span className="pill" key={pill}>
                      {pill}
                    </span>
                  ))}
                </div>
              </div>
              <div className="right2">
                <div className="mc">MC {launch.marketCap}</div>
                <div className="vol">VOL {launch.volume}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ===== RIGHT ===== */}
      <div className="dcol right">
        <Card
          title="Tokens"
          headerRight={<DropButton label="24h" />}
          style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
        >
          <div className="listscroll">
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
                {RANKED_TOKENS.map((token, index) => (
                  <RankRow
                    key={token.symbol}
                    rank={index + 1}
                    symbol={token.symbol}
                    name={token.name}
                    subLabel={token.symbol}
                    gradientIndex={index}
                    cells={[token.marketCap, <PctChange key="ch" value={token.change24h} digits={1} />]}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="Perps"
          headerRight={<DropButton label="Volume" />}
          style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
        >
          <div className="listscroll">
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
                {RANKED_PERPS.map((perp, index) => (
                  <RankRow
                    key={perp.symbol}
                    rank={index + 1}
                    symbol={perp.symbol}
                    name={`${perp.symbol}-USD`}
                    subLabel={<span className="lev">{perp.leverage}</span>}
                    gradientIndex={index + 2}
                    cells={[perp.price, <PctChange key="ch" value={perp.change24h} digits={1} />]}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
