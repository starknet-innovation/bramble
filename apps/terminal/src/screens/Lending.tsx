/**
 * Vesu V2 professional lending desk. Combines verified market discovery,
 * on-chain earn/borrow execution, position monitoring, curated vaults, reward
 * claims, and explicit oracle/utilization/collateral risk detail.
 */
import {
  Activity,
  BookOpenCheck,
  BriefcaseBusiness,
  Gift,
  Landmark,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Vault,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { avnuTokenArtwork } from "../assets/avnu-token-assets";
import { TokenIcon } from "../components";
import {
  formatCompactUsd,
  useVesuMarkets,
  useVesuPositions,
  useVesuRewards,
  useVesuRedeems,
  useVesuVaults,
  type VesuMarket,
  type VesuPosition,
} from "../data";
import { useWallet } from "../wallet/WalletProvider";
import {
  LendingPositions,
  LendingRewards,
  LendingVaults,
} from "./LendingAccountViews";
import { LendingMarketTable } from "./LendingMarketTable";
import { LendingManageModal } from "./LendingManageModal";
import {
  collateralMarketsFor,
  filterVesuMarkets,
  lendingMarketKey,
  type LendingSort,
  type LendingView,
} from "./lending-model";
import { LendingRiskPanel } from "./LendingRiskPanel";
import { LendingTicket } from "./LendingTicket";

const VIEWS: readonly {
  readonly id: LendingView;
  readonly label: string;
  readonly icon: typeof Landmark;
}[] = [
  { id: "markets", label: "Markets", icon: Landmark },
  { id: "positions", label: "Positions", icon: BriefcaseBusiness },
  { id: "vaults", label: "Vaults", icon: Vault },
  { id: "rewards", label: "Rewards", icon: Gift },
];

/** Vesu lending screen. */
export default function Lending(): ReactNode {
  const { address, isConnected, connect } = useWallet();
  const marketsResource = useVesuMarkets();
  const positions = useVesuPositions(address);
  const vaults = useVesuVaults();
  const rewards = useVesuRewards(address);
  const redeems = useVesuRedeems(address);
  const [view, setView] = useState<LendingView>("markets");
  const [selectedKey, setSelectedKey] = useState("");
  const [search, setSearch] = useState("");
  const [pool, setPool] = useState("all");
  const [sort, setSort] = useState<LendingSort>("apy");
  const [borrowableOnly, setBorrowableOnly] = useState(false);
  const [managedPosition, setManagedPosition] = useState<VesuPosition | null>(null);

  const allMarkets = marketsResource.data?.markets ?? [];
  const pairs = marketsResource.data?.pairs ?? [];
  const visibleMarkets = useMemo(
    () => filterVesuMarkets(allMarkets, search, pool, borrowableOnly, sort),
    [allMarkets, search, pool, borrowableOnly, sort],
  );
  useEffect(() => {
    if (visibleMarkets.length === 0) return;
    setSelectedKey((current) =>
      visibleMarkets.some((market) => lendingMarketKey(market) === current)
        ? current
        : lendingMarketKey(visibleMarkets[0]!),
    );
  }, [visibleMarkets]);
  const selected =
    allMarkets.find((market) => lendingMarketKey(market) === selectedKey) ?? null;
  const collateralPairs =
    selected === null ? [] : collateralMarketsFor(selected, allMarkets, pairs);
  const pools = useMemo(() => {
    const byId = new Map<string, string>();
    for (const market of allMarkets) byId.set(market.poolId, market.poolName);
    return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [allMarkets]);

  const totalSuppliedUsd = allMarkets.reduce(
    (total, market) => total + market.supplied * market.priceUsd,
    0,
  );
  const availableUsd = allMarkets.reduce(
    (total, market) => total + market.liquidity * market.priceUsd,
    0,
  );
  const bestApy = allMarkets.reduce((best, market) => Math.max(best, market.supplyApy), 0);
  const activePositions = positions.data?.length ?? 0;

  const switchView = (next: LendingView): void => {
    setView(next);
  };

  const managePosition = (position: VesuPosition): void => {
    setManagedPosition(position);
  };

  return (
    <div className="screen lending-screen" id="lending">
      <header className="lending-command">
        <div className="lending-command-title">
          <div className="lending-protocol-mark">V</div>
          <div>
            <div>
              <h1>Vesu Lending</h1>
              <span className="pill"><ShieldCheck size={10} aria-hidden /> V2 Mainnet</span>
            </div>
            <p>Isolated market execution and risk intelligence for professional lenders.</p>
          </div>
        </div>
        <nav className="lending-views" aria-label="Lending workspace">
          {VIEWS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                aria-current={view === item.id ? "page" : undefined}
                className={view === item.id ? "active" : ""}
                key={item.id}
                onClick={() => switchView(item.id)}
                type="button"
              >
                <Icon size={13} aria-hidden /> {item.label}
                {item.id === "positions" && activePositions > 0 ? <span>{activePositions}</span> : null}
              </button>
            );
          })}
        </nav>
        <button
          className="lending-refresh"
          disabled={marketsResource.isLoading}
          onClick={marketsResource.refresh}
          type="button"
        >
          <RefreshCw size={13} aria-hidden /> Sync
        </button>
      </header>

      <section className="lending-ledger" aria-label="Vesu protocol summary">
        <div><span>Verified pools</span><strong className="mono">{marketsResource.data?.poolCount ?? "—"}</strong></div>
        <div><span>Total supplied</span><strong className="mono">{formatCompactUsd(totalSuppliedUsd)}</strong></div>
        <div><span>Available liquidity</span><strong className="mono">{formatCompactUsd(availableUsd)}</strong></div>
        <div><span>Top supply APY</span><strong className="mono pos">{bestApy.toFixed(2)}%</strong></div>
        <div className="lending-ledger-status">
          <span><Activity size={11} aria-hidden /> Market state</span>
          <strong>{marketsResource.error === null ? "Live" : "Degraded"}</strong>
          <small>{marketsResource.data === null ? "Syncing" : new Date(marketsResource.data.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
        </div>
      </section>

      {view === "markets" ? (
        <div className="lending-workspace">
          <LendingMarketTable
            borrowableOnly={borrowableOnly}
            error={marketsResource.error}
            isLoading={marketsResource.isLoading}
            markets={visibleMarkets}
            onBorrowable={setBorrowableOnly}
            onPool={setPool}
            onSearch={setSearch}
            onSelect={(market: VesuMarket) => setSelectedKey(lendingMarketKey(market))}
            onSort={setSort}
            pool={pool}
            pools={pools}
            search={search}
            selected={selected}
            sort={sort}
          />
          <section className="lending-market-panel" aria-label="Selected market and action">
            {selected === null ? null : (
              <header className="lending-detail-title">
                <div className="lending-detail-identity">
                  <TokenIcon
                    logoUri={avnuTokenArtwork(selected.assetAddress, null)}
                    name={selected.name}
                    size={36}
                    symbol={selected.symbol}
                  />
                  <span>
                    <small>Selected market · {selected.symbol}</small>
                    <h2>{selected.poolName}</h2>
                  </span>
                </div>
                <div className="lending-market-badges">
                  <span className="lending-verified-state"><i aria-hidden /> Verified V2</span>
                  <span className="lending-verified-state"><LockKeyhole size={9} aria-hidden /> Wallet review</span>
                </div>
              </header>
            )}
            <div className="lending-market-body">
              <LendingRiskPanel collateralPairs={collateralPairs} market={selected} />
              <LendingTicket
                collateralPairs={collateralPairs}
                market={selected}
              />
            </div>
          </section>
        </div>
      ) : (
        <section className="lending-account-workspace">
          <header>
            <div>
              <BookOpenCheck size={18} aria-hidden />
              <span>
                <strong>{VIEWS.find((item) => item.id === view)?.label}</strong>
                <small>
                  {view === "positions"
                    ? "Open Vesu exposures and health"
                    : view === "vaults"
                      ? "Curated strategies and asynchronous redemption terms"
                      : "Incentive balances and claim proofs"}
                </small>
              </span>
            </div>
            {view === "positions" ? (
              <button onClick={positions.refresh} type="button"><RefreshCw size={12} aria-hidden /> Refresh</button>
            ) : null}
          </header>
          <div className="lending-account-body">
            {view === "positions" ? (
              <LendingPositions
                connected={isConnected}
                markets={allMarkets}
                onConnect={() => void connect()}
                onManage={managePosition}
                resource={positions}
              />
            ) : view === "vaults" ? (
              <LendingVaults positions={positions} redeems={redeems} resource={vaults} />
            ) : (
              <LendingRewards
                connected={isConnected}
                onConnect={() => void connect()}
                resource={rewards}
              />
            )}
          </div>
        </section>
      )}
      {managedPosition === null ? null : (
        <LendingManageModal
          markets={allMarkets}
          onClose={() => setManagedPosition(null)}
          onSubmitted={() => {
            positions.refresh();
            marketsResource.refresh();
          }}
          position={managedPosition}
        />
      )}
    </div>
  );
}
