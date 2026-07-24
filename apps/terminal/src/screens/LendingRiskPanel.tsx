import { ExternalLink, Gauge, Radio } from "lucide-react";
import type { ReactNode } from "react";
import { formatCompactUsd, type VesuMarket, type VesuPair } from "../data";
import { shortenAddress } from "../shell/screens";
import { InterestRateCurve } from "./InterestRateCurve";

const pct = (value: number): string => `${value.toFixed(2)}%`;

type Props = {
  readonly market: VesuMarket | null;
  readonly collateralPairs: readonly { readonly market: VesuMarket; readonly pair: VesuPair }[];
};

/** Market due-diligence panel: oracle, utilization curve, and collateral envelope. */
export const LendingRiskPanel = ({ market, collateralPairs }: Props): ReactNode => {
  if (market === null) {
    return <aside className="lending-risk empty">Select a market to inspect its risk surface.</aside>;
  }
  return (
    <aside className="lending-risk">
      <div className="lending-rate-pair">
        <div>
          <small>Supply APY</small>
          <strong className="pos mono">{pct(market.supplyApy)}</strong>
        </div>
        <div>
          <small>Borrow APR</small>
          <strong className="mono">{pct(market.borrowApr)}</strong>
        </div>
      </div>

      <section className="lending-risk-section">
        <header>
          <span><Gauge size={13} aria-hidden /> Utilization curve</span>
          <strong className="mono">{pct(market.utilization)}</strong>
        </header>
        <InterestRateCurve market={market} />
        <dl className="lending-facts">
          <div><dt>Total supplied</dt><dd>{formatCompactUsd(market.supplied * market.priceUsd)}</dd></div>
          <div><dt>Available</dt><dd>{formatCompactUsd(market.liquidity * market.priceUsd)}</dd></div>
          <div><dt>Protocol fee</dt><dd>{pct(market.feeRate)}</dd></div>
        </dl>
      </section>

      <section className="lending-risk-section">
        <header>
          <span><Radio size={13} aria-hidden /> Oracle · {market.oracleKey}</span>
          <strong className="lending-oracle-source"><i aria-hidden /> Pragma · {market.oracleSources || "?"} feeds</strong>
        </header>
        <dl className="lending-oracle-grid">
          <div><dt>Aggregation</dt><dd>{market.oracleAggregationMode}</dd></div>
          <div><dt>Freshness limit</dt><dd>{market.oracleTimeoutSeconds ? `${market.oracleTimeoutSeconds}s` : "Default"}</dd></div>
          <div><dt>Window</dt><dd>{market.oracleTimeWindowSeconds ? `${market.oracleTimeWindowSeconds}s` : "Spot"}</dd></div>
          <div><dt>Adaptive half-life</dt><dd>{Math.round(market.rateHalfLifeSeconds / 3600)}h</dd></div>
          <div><dt>Oracle contract</dt><dd title={market.oracleAddress}>{shortenAddress(market.oracleAddress)}</dd></div>
          <div><dt>Pool curator</dt><dd title={market.poolOwner}>{shortenAddress(market.poolOwner)}</dd></div>
        </dl>
      </section>

      <div className="lending-risk-links">
        <span>{collateralPairs.length} collateral {collateralPairs.length === 1 ? "pair" : "pairs"}</span>
        {market.riskUrl !== null ? (
          <a href={market.riskUrl} rel="noreferrer" target="_blank">
            Risk report <ExternalLink size={11} aria-hidden />
          </a>
        ) : null}
        <a href="https://docs.vesu.xyz/security/audits" rel="noreferrer" target="_blank">
          Audits <ExternalLink size={11} aria-hidden />
        </a>
      </div>
    </aside>
  );
};
