import { useEffect, useRef, useState } from "react";
import type { ChainPulse } from "../../data/index";

export type ChainActivityKind = "block" | "event" | "message" | "transaction";

export type ChainActivity = {
  readonly id: string;
  readonly kind: ChainActivityKind;
  readonly timestampMs: number;
  readonly blockNumber: number;
  readonly title: string;
  readonly detail: string;
  readonly href: string;
  readonly sourceTier: "finalized" | "head";
};

const REVEAL_MS = 850;
const MAX_PENDING = 48;
const MAX_VISIBLE = 22;
const MAX_SEEN = 1_000;
const CACHE_SIZE = 20;
const CACHE_KEY = "mc-terminal:chain-activity:v1";

const shortAddress = (value: string): string =>
  value.length > 13 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;

const sentenceCase = (value: string): string =>
  (value === value.toUpperCase() ? value.toLowerCase() : value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (character) => character.toUpperCase())
    .replace(/\bl([12])\b/gi, "L$1");

const cachedActivity = (value: unknown): ChainActivity | null => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const kind = row["kind"];
  const sourceTier = row["sourceTier"];
  if (
    (kind !== "block" && kind !== "event" && kind !== "message" && kind !== "transaction") ||
    (sourceTier !== "finalized" && sourceTier !== "head") ||
    typeof row["id"] !== "string" ||
    row["id"].length === 0 ||
    row["id"].length > 256 ||
    typeof row["timestampMs"] !== "number" ||
    !Number.isSafeInteger(row["timestampMs"]) ||
    row["timestampMs"] < 0 ||
    typeof row["blockNumber"] !== "number" ||
    !Number.isSafeInteger(row["blockNumber"]) ||
    row["blockNumber"] < 0 ||
    typeof row["title"] !== "string" ||
    row["title"].length === 0 ||
    row["title"].length > 256 ||
    typeof row["detail"] !== "string" ||
    row["detail"].length > 512 ||
    typeof row["href"] !== "string" ||
    !row["href"].startsWith("https://starkscan.co/")
  ) {
    return null;
  }
  return {
    blockNumber: row["blockNumber"],
    detail: row["detail"],
    href: row["href"],
    id: row["id"],
    kind,
    sourceTier,
    timestampMs: row["timestampMs"],
    title: row["title"],
  };
};

/** Reads the newest validated public chain facts saved for an instant warm start. */
export const readCachedChainActivities = (): readonly ChainActivity[] => {
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_KEY);
    if (raw === null || raw === undefined) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > CACHE_SIZE) return [];
    return value.map(cachedActivity).filter((row): row is ChainActivity => row !== null);
  } catch {
    return [];
  }
};

/** Persists exactly the newest bounded feed window; storage failures fail soft. */
export const cacheChainActivities = (activities: readonly ChainActivity[]): void => {
  try {
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(activities.slice(0, CACHE_SIZE)));
  } catch {
    // Public activity caching is an enhancement; a blocked store is harmless.
  }
};

const eventDetail = (
  label: string | null,
  value: string | null,
  contractAddress: string,
): string => {
  const contract = `Contract ${shortAddress(contractAddress)}`;
  if (label === null || value === null) return contract;
  const leaf = label.split(".").at(-1) ?? label;
  if (leaf === "variant") return `${sentenceCase(value)} · ${contract}`;
  const display = value.length > 32 ? shortAddress(value) : value;
  return `${sentenceCase(leaf)} ${display} · ${contract}`;
};

/** Normalizes the newest real Starkscan facts into one chronological activity tape. */
const toChainActivities = (pulse: ChainPulse): readonly ChainActivity[] => {
  const latestTimestamp = pulse.blocks[0]?.timestampMs ?? Number.POSITIVE_INFINITY;
  const recentMessages = pulse.messages
    .filter((message) => message.timestampMs >= latestTimestamp - 120_000)
    .slice(0, 4);
  const eventsPerTransaction = new Map<string, number>();
  const recentEvents = pulse.events
    .filter((event) => {
      const count = eventsPerTransaction.get(event.txHash) ?? 0;
      if (count >= 2) return false;
      eventsPerTransaction.set(event.txHash, count + 1);
      return true;
    })
    .slice(0, 10);
  return [
    ...pulse.blocks.slice(0, 3).map(
      (block): ChainActivity => ({
        blockNumber: block.blockNumber,
        detail: `${block.txCount.toLocaleString("en-US")} transactions · ${sentenceCase(
          block.finalityStatus,
        )}`,
        href: `https://starkscan.co/block/${block.blockNumber}`,
        id: `block:${block.blockNumber}`,
        kind: "block",
        sourceTier: block.finalityStatus.includes("L1") ? "finalized" : "head",
        timestampMs: block.timestampMs,
        title: `Block #${block.blockNumber.toLocaleString("en-US")}`,
      }),
    ),
    ...pulse.transactions.slice(0, 10).map(
      (transaction): ChainActivity => ({
        blockNumber: transaction.blockNumber,
        detail: `${shortAddress(transaction.fromAddress)} → ${shortAddress(transaction.toAddress)}`,
        href: `https://starkscan.co/tx/${transaction.txHash}`,
        id: transaction.id,
        kind: "transaction",
        sourceTier: transaction.finalityStatus.includes("L2") ? "head" : "finalized",
        timestampMs: transaction.timestampMs,
        title:
          transaction.executionStatus === "SUCCEEDED"
            ? "Transaction succeeded"
            : `Transaction ${sentenceCase(transaction.executionStatus)}`,
      }),
    ),
    ...recentEvents.map(
      (event): ChainActivity => ({
        blockNumber: event.blockNumber,
        detail: eventDetail(event.detailLabel, event.detailValue, event.contractAddress),
        href: `https://starkscan.co/tx/${event.txHash}`,
        id: event.id,
        kind: "event",
        sourceTier: event.sourceTier,
        timestampMs: event.timestampMs,
        title: sentenceCase(event.eventName),
      }),
    ),
    ...recentMessages.map(
      (message): ChainActivity => ({
        blockNumber: message.blockNumber,
        detail: `${sentenceCase(message.status)} · ${shortAddress(
          message.fromAddress,
        )} → ${shortAddress(message.toAddress)}`,
        href: `https://starkscan.co/tx/${message.txHash}`,
        id: message.id,
        kind: "message",
        sourceTier: message.sourceTier,
        timestampMs: message.timestampMs,
        title: message.direction === "l1_to_l2" ? "L1 → L2 message" : "L2 → L1 message",
      }),
    ),
  ].sort(
    (left, right) =>
      left.timestampMs - right.timestampMs ||
      left.blockNumber - right.blockNumber ||
      left.id.localeCompare(right.id),
  );
};

const KIND_ORDER: readonly ChainActivityKind[] = ["block", "transaction", "event", "message"];

/**
 * Fairly interleaves activity kinds while preserving chronology within each
 * kind, preventing a busy event page from becoming a long single-type burst.
 */
export const interleaveChainActivities = (
  activities: readonly ChainActivity[],
): readonly ChainActivity[] => {
  const ordered = [...activities].sort(
    (left, right) =>
      left.timestampMs - right.timestampMs ||
      left.blockNumber - right.blockNumber ||
      left.id.localeCompare(right.id),
  );
  const queues = new Map<ChainActivityKind, ChainActivity[]>(
    KIND_ORDER.map((kind) => [kind, ordered.filter((activity) => activity.kind === kind)]),
  );
  const result: ChainActivity[] = [];
  let cursor = Math.max(0, KIND_ORDER.indexOf(ordered[0]?.kind ?? "block"));
  while (result.length < ordered.length) {
    let found = false;
    for (let offset = 0; offset < KIND_ORDER.length; offset += 1) {
      const index = (cursor + offset) % KIND_ORDER.length;
      const kind = KIND_ORDER[index];
      if (kind === undefined) continue;
      const next = queues.get(kind)?.shift();
      if (next === undefined) continue;
      result.push(next);
      cursor = (index + 1) % KIND_ORDER.length;
      found = true;
      break;
    }
    if (!found) break;
  }
  return result;
};

/**
 * Accumulates successive chain snapshots and reveals facts one at a time so new
 * activity enters as a continuous tape instead of replacing the whole list.
 */
export const useChainActivityStream = (pulse: ChainPulse | null): readonly ChainActivity[] => {
  const initialRef = useRef<readonly ChainActivity[]>(readCachedChainActivities());
  const [visible, setVisible] = useState<readonly ChainActivity[]>(initialRef.current);
  const pendingRef = useRef<ChainActivity[]>([]);
  const seenRef = useRef(new Set(initialRef.current.map((activity) => activity.id)));

  useEffect(() => {
    if (pulse === null) return;
    const unseen = toChainActivities(pulse).filter((activity) => !seenRef.current.has(activity.id));
    for (const activity of unseen) {
      seenRef.current.add(activity.id);
    }
    while (seenRef.current.size > MAX_SEEN) {
      const oldest = seenRef.current.values().next().value;
      if (oldest === undefined) break;
      seenRef.current.delete(oldest);
    }
    const bounded = [...pendingRef.current, ...unseen]
      .sort(
        (left, right) =>
          left.timestampMs - right.timestampMs ||
          left.blockNumber - right.blockNumber ||
          left.id.localeCompare(right.id),
      )
      .slice(-MAX_PENDING);
    pendingRef.current = [...interleaveChainActivities(bounded)];
  }, [pulse]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const next = pendingRef.current.shift();
      if (next === undefined) return;
      setVisible((current) => {
        const updated = [next, ...current].slice(0, MAX_VISIBLE);
        cacheChainActivities(updated);
        return updated;
      });
    }, REVEAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  return visible;
};
