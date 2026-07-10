/**
 * Portfolio screen — a Total/Tokens/Perps hero (balance + P&L) over a tabbed
 * body (Tokens / Perps / Token Activity / Perps Activity / Top Gainer or Loser).
 * Disconnected, the body is a large centered "connect wallet" empty state,
 * matching the mockup's empty-first design. Once connected, the selected body
 * tab renders sample holdings / positions / activity. All figures are static
 * sample data (see portfolioData.ts) — no on-chain reads are wired here. See
 * the MANIFEST.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Card, EmptyState, PctChange, RankRow, SegmentedTabs, TabStrip } from "../components";
import { useWallet } from "../wallet/WalletProvider";
import {
  formatSignedUSD,
  formatUSD,
  HOLDINGS,
  PERP_ACTIVITY,
  PERP_POSITIONS,
  PORTFOLIO_TOTALS,
  TOKEN_ACTIVITY,
  type Activity,
  type Holding,
} from "./portfolioData";

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

const activityRow = (a: Activity, rank: number): ReactNode => {
  const tone = a.kind === "Buy" || a.kind === "Open" ? "pos" : "neg";
  return (
    <RankRow
      key={`${a.symbol}-${a.time}`}
      rank={rank}
      symbol={a.symbol}
      name={a.symbol}
      subLabel={a.time}
      gradientIndex={a.gradientIndex}
      cells={[
        <span key="kind" className={tone} style={{ fontWeight: 700 }}>
          {a.kind}
        </span>,
        a.amount,
        formatUSD(a.value),
      ]}
    />
  );
};

export default function Portfolio(): ReactNode {
  const { isConnected, isConnecting, connect } = useWallet();
  const [heroTab, setHeroTab] = useState<HeroTab>("total");
  const [bodyTab, setBodyTab] = useState<BodyTab>("tokens");

  const hero = PORTFOLIO_TOTALS[heroTab];
  const balance = isConnected ? hero.balance : 0;
  const pnl = isConnected ? hero.pnl : 0;
  const pnlPct = isConnected ? hero.pnlPct : 0;

  const [topGainer, topLoser] = useMemo(() => {
    const sorted = [...HOLDINGS].sort((a, b) => b.change - a.change);
    return [sorted[0], sorted[sorted.length - 1]] as const;
  }, []);

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

    if (bodyTab === "tokens") {
      return (
        <table className="ranktable">
          <TableHead cols={["Token", "Balance", "Value", "24h"]} />
          <tbody>
            {HOLDINGS.map((h, i) => (
              <RankRow
                key={h.symbol}
                rank={i + 1}
                symbol={h.symbol}
                name={h.symbol}
                subLabel={h.name}
                gradientIndex={h.gradientIndex}
                cells={[h.balance, formatUSD(h.value), <PctChange key="chg" value={h.change} />]}
              />
            ))}
          </tbody>
        </table>
      );
    }

    if (bodyTab === "perps") {
      return (
        <table className="ranktable">
          <TableHead cols={["Market", "Size", "Entry", "Mark", "PnL"]} />
          <tbody>
            {PERP_POSITIONS.map((p, i) => {
              const pnlPctPos = (p.pnl / p.margin) * 100;
              return (
                <RankRow
                  key={p.market}
                  rank={i + 1}
                  symbol={p.market}
                  name={p.market}
                  subLabel={
                    <span>
                      <span className={p.side === "Long" ? "pos" : "neg"}>{p.side}</span>{" "}
                      <span className="lev">{p.leverage}x</span>
                    </span>
                  }
                  gradientIndex={p.gradientIndex}
                  cells={[
                    formatUSD(p.size),
                    p.entry.toLocaleString("en-US"),
                    p.mark.toLocaleString("en-US"),
                    <span key="pnl" className={p.pnl < 0 ? "neg" : "pos"}>
                      {formatSignedUSD(p.pnl)}{" "}
                      <PctChange value={pnlPctPos} />
                    </span>,
                  ]}
                />
              );
            })}
          </tbody>
        </table>
      );
    }

    if (bodyTab === "tokenActivity" || bodyTab === "perpActivity") {
      const rows = bodyTab === "tokenActivity" ? TOKEN_ACTIVITY : PERP_ACTIVITY;
      return (
        <table className="ranktable">
          <TableHead cols={["Asset", "Type", "Amount", "Value"]} />
          <tbody>{rows.map((a, i) => activityRow(a, i + 1))}</tbody>
        </table>
      );
    }

    // topMovers
    const movers = [topGainer, topLoser].filter((h): h is Holding => h !== undefined);
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
              gradientIndex={h.gradientIndex}
              cells={[formatUSD(h.value), <PctChange key="chg" value={h.change} />]}
            />
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div className="screen" id="portfolio">
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
            <div className="val">{formatUSD(balance)}</div>
          </div>
          <div>
            <div className="lbl">P&amp;L</div>
            <div
              className={`val ${pnl < 0 ? "neg" : "pos"}`}
              style={{ fontSize: 20, display: "flex", alignItems: "baseline", gap: 8 }}
            >
              <span className="mono">{formatSignedUSD(pnl)}</span>
              <PctChange value={pnlPct} />
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
