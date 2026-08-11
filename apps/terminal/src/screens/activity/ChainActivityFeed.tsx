import { Blocks, Cable, FileCheck2, RadioTower } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChainPulse } from "../../data/index";
import {
  type ChainActivity,
  type ChainActivityKind,
  useChainActivityStream,
} from "./chain-activity-stream";

type ChainActivityFeedProps = {
  readonly pulse: ChainPulse;
};

const KIND_LABELS: Readonly<Record<ChainActivityKind, string>> = {
  block: "Block",
  event: "Event",
  message: "Bridge",
  transaction: "Transaction",
};

const activityIcon = (kind: ChainActivityKind): ReactNode => {
  if (kind === "block") return <Blocks aria-hidden="true" size={16} strokeWidth={1.8} />;
  if (kind === "transaction") {
    return <FileCheck2 aria-hidden="true" size={16} strokeWidth={1.8} />;
  }
  if (kind === "message") return <Cable aria-hidden="true" size={16} strokeWidth={1.8} />;
  return <RadioTower aria-hidden="true" size={16} strokeWidth={1.8} />;
};

const relativeAge = (timestampMs: number, nowMs: number): string => {
  const seconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1_000));
  if (seconds < 2) return "now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
};

const ActivityRow = ({
  activity,
  nowMs,
}: {
  readonly activity: ChainActivity;
  readonly nowMs: number;
}): ReactNode => (
  <a
    aria-label={`View ${activity.kind}: ${activity.title} on Starkscan`}
    className={`chain-row ${activity.kind}`}
    href={activity.href}
    rel="noreferrer"
    target="_blank"
  >
    <span className="chain-event-icon" aria-hidden="true">
      {activityIcon(activity.kind)}
    </span>
    <span className="chain-event">
      <span className="chain-event-heading">
        <span className="chain-kind">{KIND_LABELS[activity.kind]}</span>
        <strong>{activity.title}</strong>
      </span>
      <span className="chain-event-detail mono">{activity.detail}</span>
    </span>
    <span className="chain-event-meta">
      <span className={`chain-tier ${activity.sourceTier}`}>
        {activity.sourceTier === "head" ? "Head" : "Final"}
      </span>
      <time className="mono" dateTime={new Date(activity.timestampMs).toISOString()}>
        {relativeAge(activity.timestampMs, nowMs)}
      </time>
    </span>
  </a>
);

/**
 * Continuously reveals new indexed facts while updating every visible age once
 * per second. Existing rows remain stable as new activity enters above them.
 */
export const ChainActivityFeed = ({ pulse }: ChainActivityFeedProps): ReactNode => {
  const activities = useChainActivityStream(pulse);
  const initialIdsRef = useRef(new Set(activities.map((activity) => activity.id)));
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  if (activities.length === 0) {
    return (
      <div className="chain-stream-awaiting" role="status">
        <span aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        Tuning into Starknet activity…
      </div>
    );
  }

  return (
    <div
      aria-label="Streaming Starknet blocks, transactions, events, and bridge messages"
      className="chain-feed"
      role="feed"
    >
      {activities.map((activity) => (
        <div
          className={
            initialIdsRef.current.has(activity.id)
              ? "chain-row-slot cached"
              : "chain-row-slot"
          }
          key={activity.id}
          role="article"
        >
          <ActivityRow activity={activity} nowMs={nowMs} />
        </div>
      ))}
    </div>
  );
};
