import { ArrowDown, CheckCircle2, Radio, Search, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { avnuTokenArtwork } from "../../assets/avnu-token-assets";
import { ErrorBanner, SkeletonRows, TokenIcon } from "../../components/index";
import { formatCompactUsd } from "../../data/index";
import type { VesuMarket } from "../../data/index";
import { lendingMarketKey, riskTone, type LendingSort } from "./lending-model";

type Props = {
  readonly markets: readonly VesuMarket[];
  readonly selected: VesuMarket | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly search: string;
  readonly sort: LendingSort;
  readonly pools: readonly { readonly id: string; readonly name: string }[];
  readonly pool: string;
  readonly borrowableOnly: boolean;
  readonly onSearch: (value: string) => void;
  readonly onSort: (value: LendingSort) => void;
  readonly onPool: (value: string) => void;
  readonly onBorrowable: (value: boolean) => void;
  readonly onSelect: (market: VesuMarket) => void;
};

const percent = (value: number): string => `${value.toFixed(2)}%`;

/** Dense scanner for verified Vesu V2 isolated lending markets. */
export const LendingMarketTable = ({
  markets,
  selected,
  isLoading,
  error,
  search,
  sort,
  pools,
  pool,
  borrowableOnly,
  onSearch,
  onSort,
  onPool,
  onBorrowable,
  onSelect,
}: Props): ReactNode => (
  <section className="lending-scanner" aria-label="Vesu market scanner">
    <header className="lending-scanner-head">
      <div>
        <span>Market book</span>
        <strong>Verified Vesu V2 pools</strong>
      </div>
      <span className="lending-market-count">
        <i aria-hidden />
        {markets.length} live markets
      </span>
    </header>
    <div className="lending-scanner-tools">
      <label className="lending-search">
        <Search size={13} aria-hidden />
        <span className="sr-only">Search Vesu markets</span>
        <input
          value={search}
          onChange={(event) => onSearch(event.currentTarget.value)}
          placeholder="Asset or pool"
        />
      </label>
      <select
        aria-label="Filter by pool"
        className="lending-select"
        value={pool}
        onChange={(event) => onPool(event.currentTarget.value)}
      >
        <option value="all">All verified pools</option>
        {pools.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Sort markets"
        className="lending-select"
        value={sort}
        onChange={(event) => onSort(event.currentTarget.value as LendingSort)}
      >
        <option value="apy">Highest supply APY</option>
        <option value="borrow">Lowest borrow APR</option>
        <option value="liquidity">Most liquidity</option>
        <option value="utilization">Highest utilization</option>
      </select>
      <label className="lending-check">
        <input
          checked={borrowableOnly}
          onChange={(event) => onBorrowable(event.currentTarget.checked)}
          type="checkbox"
        />
        Borrowable
      </label>
    </div>
    <div className="lending-table-head" aria-hidden>
      <span>Asset / pool</span>
      <span>Supply APY</span>
      <span>Borrow APR</span>
      <span>Liquidity</span>
      <span>Utilization</span>
    </div>
    <div className="lending-market-scroll">
      {error !== null && markets.length === 0 ? (
        <ErrorBanner message={`Couldn't load Vesu: ${error}`} />
      ) : isLoading && markets.length === 0 ? (
        <SkeletonRows rows={10} />
      ) : markets.length === 0 ? (
        <div className="lending-empty">No verified markets match these filters.</div>
      ) : (
        markets.map((market, index) => {
          const tone = riskTone(market.utilization, market.targetUtilization, market.maxUtilization);
          return (
            <button
              className={
                lendingMarketKey(market) ===
                (selected === null ? "" : lendingMarketKey(selected))
                  ? "lending-market-row selected"
                  : "lending-market-row"
              }
              key={lendingMarketKey(market)}
              onClick={() => onSelect(market)}
              type="button"
            >
              <span className="lending-asset-cell">
                <TokenIcon
                  colorIndex={index}
                  logoUri={avnuTokenArtwork(market.assetAddress, null)}
                  name={market.name}
                  size={32}
                  symbol={market.symbol}
                />
                <span>
                  <strong>{market.symbol}</strong>
                  <small>
                    {market.poolName}
                    <CheckCircle2 size={10} aria-label="Verified pool" />
                  </small>
                  <small className="lending-row-oracle" title={`${market.oracleKey} via ${market.oracleAddress}`}>
                    <Radio size={9} aria-hidden /> {market.oracleKey} · {market.oracleSources || "?"} src
                  </small>
                </span>
              </span>
              <span className="mono pos">{percent(market.supplyApy)}</span>
              <span className="mono">{percent(market.borrowApr)}</span>
              <span className="mono">{formatCompactUsd(market.liquidity * market.priceUsd)}</span>
              <span className="lending-util-cell">
                <span className={`lending-util-track ${tone}`}>
                  <span style={{ width: `${Math.min(100, market.utilization)}%` }} />
                </span>
                <span className="mono">{percent(market.utilization)}</span>
              </span>
            </button>
          );
        })
      )}
    </div>
    <footer className="lending-scanner-foot">
      <span>
        <ShieldCheck size={12} aria-hidden /> V2 · verified pools only
      </span>
      <span>
        Click a row for oracle, curve, collateral, and execution detail
        <ArrowDown size={11} aria-hidden />
      </span>
    </footer>
  </section>
);
