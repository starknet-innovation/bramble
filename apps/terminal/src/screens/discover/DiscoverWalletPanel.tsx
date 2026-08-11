import {
  ArrowUpRight,
  BriefcaseBusiness,
  Clock3,
  Star,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { avnuTokenArtwork } from "../../assets/avnu-token-assets";
import { EmptyState, ErrorBanner, SkeletonRows, TabStrip, TokenIcon } from "../../components/index";
import {
  useFollowedAssets,
  useVesuPositions,
  useWalletActivity,
  type VesuPosition,
  type WalletActivity,
} from "../../data/index";
import type { ScreenId } from "../../shell/screens";

type WalletTab = "activities" | "follows" | "positions";

type DiscoverWalletPanelProps = {
  readonly address: string | null;
  readonly isConnected: boolean;
  readonly isConnecting: boolean;
  readonly onConnect: () => void;
  readonly onNavigate: (screen: ScreenId) => void;
};

const positionTitle = (position: VesuPosition): string =>
  `${position.type[0]?.toUpperCase() ?? ""}${position.type.slice(1)} ${position.collateralSymbol}`;

const positionDetail = (position: VesuPosition): string => {
  const collateral = `${position.collateralAmount.toLocaleString("en-US", {
    maximumFractionDigits: 5,
  })} ${position.collateralSymbol}`;
  if (position.debtSymbol === null) return collateral;
  return `${collateral} · ${position.debtAmount.toLocaleString("en-US", {
    maximumFractionDigits: 5,
  })} ${position.debtSymbol} debt`;
};

const activityAge = (activity: WalletActivity, nowMs: number): string => {
  const seconds = Math.max(0, Math.floor((nowMs - activity.timestampMs) / 1_000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
};

/** Connected-account positions, activity, and persisted market follows. */
export const DiscoverWalletPanel = ({
  address,
  isConnected,
  isConnecting,
  onConnect,
  onNavigate,
}: DiscoverWalletPanelProps): ReactNode => {
  const [tab, setTab] = useState<WalletTab>("positions");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const positions = useVesuPositions(address);
  const activities = useWalletActivity(address);
  const follows = useFollowedAssets();

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  const tabs = useMemo(
    () => [
      {
        label: (
          <>
            Positions
            {isConnected && (positions.data?.length ?? 0) > 0 ? (
              <span className="discover-tab-count">{positions.data?.length}</span>
            ) : null}
          </>
        ),
        value: "positions" as const,
      },
      {
        label: (
          <>
            Activities
            {isConnected && (activities.data?.length ?? 0) > 0 ? (
              <span className="discover-tab-count">{activities.data?.length}</span>
            ) : null}
          </>
        ),
        value: "activities" as const,
      },
      {
        label: (
          <>
            Follows
            {follows.items.length > 0 ? (
              <span className="discover-tab-count">{follows.items.length}</span>
            ) : null}
          </>
        ),
        value: "follows" as const,
      },
    ],
    [activities.data?.length, follows.items.length, isConnected, positions.data?.length],
  );

  if (!isConnected) {
    return (
      <>
        <TabStrip<WalletTab> items={tabs} value={tab} onChange={setTab} />
        <EmptyState
          icon={<Wallet size={22} strokeWidth={1.75} />}
          title="Connect your wallet"
          subtitle="Connect your wallet to see positions, activity, and follows."
          ctaLabel="Connect Wallet"
          onCta={onConnect}
          ctaDisabled={isConnecting}
          style={{ flex: 1 }}
        />
      </>
    );
  }

  const positionsBody = (): ReactNode => {
    if (positions.error !== null && positions.data === null) {
      return <ErrorBanner message="Couldn't load your Vesu positions. Retrying automatically." />;
    }
    if (positions.isLoading && positions.data === null) return <SkeletonRows rows={5} />;
    if ((positions.data?.length ?? 0) === 0) {
      return (
        <EmptyState
          icon={<BriefcaseBusiness size={22} strokeWidth={1.75} />}
          title="No open positions"
          subtitle="Open Vesu positions will appear here."
          style={{ flex: 1 }}
        />
      );
    }
    return (
      <div className="discover-wallet-list">
        {positions.data?.map((position, index) => (
          <button
            aria-label={`Open ${positionTitle(position)} in Lending`}
            className="discover-wallet-row"
            key={position.id}
            onClick={() => onNavigate("lending")}
            type="button"
          >
            <TokenIcon
              colorIndex={index}
              logoUri={avnuTokenArtwork(position.collateralAddress, null)}
              name={position.collateralSymbol}
              size={28}
              symbol={position.collateralSymbol}
            />
            <span className="discover-wallet-copy">
              <strong>{positionTitle(position)}</strong>
              <small>{positionDetail(position)}</small>
              <small>{position.poolName} · Vesu</small>
            </span>
            <span className="discover-wallet-meta">
              {position.healthFactor === null ? null : (
                <span className={position.healthFactor < 1.25 ? "neg" : "pos"}>
                  {position.healthFactor.toFixed(2)}×
                </span>
              )}
              <ArrowUpRight size={13} aria-hidden />
            </span>
          </button>
        ))}
      </div>
    );
  };

  const activityBody = (): ReactNode => {
    if (activities.error !== null && activities.data === null) {
      return <ErrorBanner message="Couldn't load wallet activity. Retrying automatically." />;
    }
    if (activities.isLoading && activities.data === null) return <SkeletonRows rows={5} />;
    if ((activities.data?.length ?? 0) === 0) {
      return (
        <EmptyState
          icon={<Clock3 size={22} strokeWidth={1.75} />}
          title="No indexed activity"
          subtitle="Recent wallet transactions will appear after Starkscan indexes them."
          style={{ flex: 1 }}
        />
      );
    }
    return (
      <div className="discover-wallet-list">
        {activities.data?.slice(0, 12).map((activity) => (
          <a
            aria-label={`View ${activity.title} on Starkscan`}
            className="discover-wallet-row"
            href={`https://starkscan.co/tx/${activity.txHash}`}
            key={activity.id}
            rel="noreferrer"
            target="_blank"
          >
            <span className="discover-activity-mark" aria-hidden>
              <Clock3 size={14} />
            </span>
            <span className="discover-wallet-copy">
              <strong>{activity.title}</strong>
              <small>{activity.detail}</small>
            </span>
            <span className="discover-wallet-meta">
              <span className={`discover-finality ${activity.finality}`}>
                {activity.finality === "final" ? "Final" : "L2"}
              </span>
              <time dateTime={new Date(activity.timestampMs).toISOString()}>
                {activityAge(activity, nowMs)}
              </time>
            </span>
          </a>
        ))}
      </div>
    );
  };

  const followsBody = (): ReactNode => {
    if (follows.items.length === 0) {
      return (
        <EmptyState
          icon={<Star size={22} strokeWidth={1.75} />}
          title="No follows yet"
          subtitle="Follow a token or perp market to keep it here."
          style={{ flex: 1 }}
        />
      );
    }
    return (
      <div className="discover-wallet-list">
        {follows.items.map((item, index) => (
          <button
            aria-label={`Open followed ${item.name}`}
            className="discover-wallet-row"
            key={`${item.kind}:${item.id}`}
            onClick={() => onNavigate(item.kind === "token" ? "tokens" : "perps")}
            type="button"
          >
            <TokenIcon
              colorIndex={index}
              logoUri={item.logoUri}
              name={item.name}
              size={28}
              symbol={item.symbol}
            />
            <span className="discover-wallet-copy">
              <strong>{item.name}</strong>
              <small>{item.symbol} · {item.kind === "token" ? "Token" : "Perpetual"}</small>
            </span>
            <span className="discover-wallet-meta">
              <ArrowUpRight size={13} aria-hidden />
            </span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <>
      <TabStrip<WalletTab> items={tabs} value={tab} onChange={setTab} />
      <div className="discover-wallet-body">
        {tab === "positions" ? positionsBody() : tab === "activities" ? activityBody() : followsBody()}
      </div>
    </>
  );
};
