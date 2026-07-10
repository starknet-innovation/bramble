/**
 * Portfolio screen — a Total/Tokens/Perps hero (balance + 24h P&L) over a tabbed
 * body. Holdings and totals are REAL: `usePortfolio` reads the connected
 * address's on-chain ERC20 balances (RPC `balanceOf`) and prices them with live
 * CoinGecko USD prices. Disconnected, the body is the "connect wallet" empty
 * state. Perp positions and activity history have NO confirmed data source yet,
 * so those tabs render an explicit "coming soon" empty state — never fabricated
 * rows.
 */
import { useMemo, useState, type ReactNode } from "react";
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
import { formatSignedUsd, formatUsd, usePortfolio, type Holding } from "../data";
import { useWallet } from "../wallet/WalletProvider";

type HeroTab = "total" | "tokens" | "perps";
type BodyTab = "tokens" | "perps" | "tokenActivity" | "perpActivity" | "topMovers";

const HERO_OPTIONS = [
  { value: "total", label: "Total" },
  { value: "tokens", label: "Tokens" },
  { value: "perps", label: "Perps" },
] as const;

const BODY_ITEMS = [
  { value: "tokens", label: "Tokens" },
  { value: "perps", label: "Perps" },
  { value: "tokenActivity", label: "Token Activity" },
  { value: "perpActivity", label: "Perps Activity" },
  { value: "topMovers", label: "Top Gainer / Loser" },
] as const;

// A compact header row for the ranked tables in the body.
const TableHead = ({ cols }: { readonly cols: readonly string[] }): ReactNode => (
  <thead>
    <tr>
      <th>#</th>
      {cols.map((c) => (
        <th key={c}>{c}</th>
      ))}
    </tr>
  </thead>
);

export default function Portfolio(): ReactNode {
  const { address, isConnected, isConnecting, connect } = useWallet();
  const { data: portfolio, isLoading, error } = usePortfolio(address);
  const [heroTab, setHeroTab] = useState<HeroTab>("total");
  const [bodyTab, setBodyTab] = useState<BodyTab>("tokens");

  // Perps have no confirmed on-chain/API source in this build, so the perps
  // hero slice is zero and the perps body tab is an explicit empty state.
  const heroValues = useMemo(() => {
    if (!isConnected) {
      return { balance: 0, pnl: 0, pnlPct: 0 };
    }
    if (heroTab === "perps") {
      return { balance: 0, pnl: 0, pnlPct: 0 };
    }
    return {
      balance: portfolio.totalValueUsd,
      pnl: portfolio.pnl24hUsd,
      pnlPct: portfolio.pnl24hPct,
    };
  }, [isConnected, heroTab, portfolio]);

  const [topGainer, topLoser] = useMemo(() => {
    const withChange = portfolio.holdings.filter((h) => h.change24h !== null);
    const sorted = [...withChange].sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0));
    return [sorted[0], sorted[sorted.length - 1]] as const;
  }, [portfolio.holdings]);

  const renderBody = (): ReactNode => {
    if (!isConnected) {
      return (
        <EmptyState
          icon="💼"
          title="Your portfolio is empty"
          subtitle="Connect your Starknet wallet to view your token holdings, perps positions, and activity."
          ctaLabel="Connect Wallet"
          onCta={() => void connect()}
          ctaDisabled={isConnecting}
          style={{ flex: 1 }}
        />
      );
    }

    if (isLoading && portfolio.holdings.length === 0) {
      return <SkeletonRows rows={5} />;
    }

    if (bodyTab === "tokens") {
      if (portfolio.holdings.length === 0) {
        return (
          <EmptyState
            icon="🪙"
            title="No token balances"
            subtitle="This wallet holds none of the tracked Starknet tokens."
            style={{ flex: 1 }}
          />
        );
      }
      return (
        <table className="ranktable">
          <TableHead cols={["Token", "Balance", "Value", "24h"]} />
          <tbody>
            {portfolio.holdings.map((h, i) => (
              <RankRow
                key={h.symbol}
                rank={i + 1}
                symbol={h.symbol}
                name={h.symbol}
                subLabel={h.name}
                gradientIndex={i}
                cells={[
                  h.display,
                  formatUsd(h.usdValue),
                  h.change24h === null ? "—" : <PctChange key="chg" value={h.change24h} />,
                ]}
              />
            ))}
          </tbody>
        </table>
      );
    }

    if (bodyTab === "perps") {
      return (
        <EmptyState
          icon="📈"
          title="Perps positions — coming soon"
          subtitle="Live perpetual positions aren't wired to a data source in this build yet. No positions are shown rather than placeholder data."
          style={{ flex: 1 }}
        />
      );
    }

    if (bodyTab === "tokenActivity" || bodyTab === "perpActivity") {
      return (
        <EmptyState
          icon="🧾"
          title="Activity history — coming soon"
          subtitle="Transaction and trade history isn't wired to an indexer yet. This is an empty state, not sample activity."
          style={{ flex: 1 }}
        />
      );
    }

    // topMovers — derived from the real holdings' 24h change.
    const movers = [topGainer, topLoser].filter((h): h is Holding => h !== undefined);
    if (movers.length === 0) {
      return (
        <EmptyState
          icon="📊"
          title="No movers to show"
          subtitle="Hold a priced token to see your top gainer and loser."
          style={{ flex: 1 }}
        />
      );
    }
    return (
      <table className="ranktable">
        <TableHead cols={["Token", "Value", "24h"]} />
        <tbody>
          {movers.map((h, i) => (
            <RankRow
              key={h.symbol}
              rank={i + 1}
              symbol={h.symbol}
              name={h.symbol}
              subLabel={i === 0 ? "Top gainer" : "Top loser"}
              gradientIndex={i}
              cells={[
                formatUsd(h.usdValue),
                h.change24h === null ? "—" : <PctChange key="chg" value={h.change24h} />,
              ]}
            />
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div className="screen" id="portfolio">
      {isConnected && error !== null && (
        <ErrorBanner message={`Couldn't load portfolio: ${error}`} />
      )}
      <Card className="pf-top">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Portfolio</div>
          <SegmentedTabs<HeroTab>
            options={HERO_OPTIONS}
            value={heroTab}
            onChange={setHeroTab}
            variant="subtabs"
          />
        </div>
        <div className="pf-balrow">
          <div>
            <div className="lbl">Balance</div>
            <div className="val">{formatUsd(heroValues.balance)}</div>
          </div>
          <div>
            <div className="lbl">P&amp;L (24h)</div>
            <div
              className={`val ${heroValues.pnl < 0 ? "neg" : "pos"}`}
              style={{ fontSize: 20, display: "flex", alignItems: "baseline", gap: 8 }}
            >
              <span className="mono">{formatSignedUsd(heroValues.pnl)}</span>
              <PctChange value={heroValues.pnlPct} />
            </div>
          </div>
        </div>
      </Card>

      <Card className="pf-body">
        <TabStrip<BodyTab>
          items={BODY_ITEMS}
          value={bodyTab}
          onChange={setBodyTab}
          style={{ padding: "0 6px" }}
        />
        {renderBody()}
      </Card>
    </div>
  );
}
