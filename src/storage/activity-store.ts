/**
 * Local activity log for transactions this wallet submitted. Plain data kept
 * outside the encrypted vault; the clock stays injectable for tests.
 */
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import {
  isStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "../starknet/networks";
import type { KeyValueStore } from "./kv";

/**
 * Browser storage key for the activity log.
 */
export const ACTIVITY_STORE_KEY = "mc-wallet:activity";

const MAX_ENTRIES = 200;

/**
 * System wall-clock reader. Lives in this clock-boundary module so other
 * stores (for example origin history) can inject a real clock without
 * touching `Date.now` themselves.
 */
export const systemClock = (): number => Date.now();

/**
 * Lifecycle status of a submitted transaction.
 */
export type ActivityStatus = "accepted" | "pending" | "rejected" | "reverted";

/**
 * One recorded transaction.
 */
export type ActivityEntry = {
  readonly accountId: string;
  readonly hash: string;
  readonly kind: "deploy" | "invoke" | "transfer";
  readonly networkId: StarknetNetworkId;
  readonly status: ActivityStatus;
  readonly submittedAt: number;
  readonly summary: string;
};

/**
 * Activity log surface used by background message handling.
 */
export type ActivityLog = {
  readonly list: () => Promise<readonly ActivityEntry[]>;
  readonly record: (entry: Omit<ActivityEntry, "status" | "submittedAt">) => Promise<void>;
  readonly updateStatuses: (
    statuses: Readonly<Record<string, ActivityStatus>>,
  ) => Promise<readonly ActivityEntry[]>;
};

const isActivityStatus = (value: unknown): value is ActivityStatus =>
  value === "accepted" || value === "pending" || value === "rejected" || value === "reverted";

const isActivityKind = (value: unknown): value is ActivityEntry["kind"] =>
  value === "deploy" || value === "invoke" || value === "transfer";

/**
 * Checks stored activity entries before trusting them.
 */
export const isActivityEntry = (value: unknown): value is ActivityEntry =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "accountId",
    "hash",
    "kind",
    "networkId",
    "status",
    "submittedAt",
    "summary",
  ]) &&
  typeof value.accountId === "string" &&
  value.accountId.length > 0 &&
  typeof value.hash === "string" &&
  isStarkFieldElement(value.hash) &&
  isActivityKind(value.kind) &&
  isStarknetNetworkId(value.networkId) &&
  isActivityStatus(value.status) &&
  typeof value.submittedAt === "number" &&
  Number.isSafeInteger(value.submittedAt) &&
  value.submittedAt >= 0 &&
  typeof value.summary === "string" &&
  value.summary.length > 0 &&
  value.summary.length <= 200;

const readEntries = async (store: KeyValueStore): Promise<readonly ActivityEntry[]> => {
  const stored = await store.get(ACTIVITY_STORE_KEY);
  return Array.isArray(stored) ? stored.filter(isActivityEntry) : [];
};

/**
 * Creates the persistent activity log.
 */
export const createActivityLog = ({
  now = () => Date.now(),
  store,
}: {
  readonly now?: () => number;
  readonly store: KeyValueStore;
}): ActivityLog => ({
  async list() {
    const entries = await readEntries(store);
    return [...entries].sort((a, b) => b.submittedAt - a.submittedAt);
  },
  async record(entry) {
    const next: ActivityEntry = { ...entry, status: "pending", submittedAt: now() };
    if (!isActivityEntry(next)) {
      return;
    }
    const entries = await readEntries(store);
    const kept = entries.filter((stored) => stored.hash !== next.hash).slice(-(MAX_ENTRIES - 1));
    await store.set(ACTIVITY_STORE_KEY, [...kept, next]);
  },
  async updateStatuses(statuses) {
    const entries = await readEntries(store);
    const updated = entries.map((entry) => {
      const status = statuses[entry.hash];
      return status && isActivityStatus(status) && status !== entry.status
        ? { ...entry, status }
        : entry;
    });
    await store.set(ACTIVITY_STORE_KEY, updated);
    return [...updated].sort((a, b) => b.submittedAt - a.submittedAt);
  },
});

/**
 * In-memory activity log used as the test default.
 */
export const memoryActivityLog = (now: () => number = () => 0): ActivityLog => {
  const entries: ActivityEntry[] = [];
  return {
    async list() {
      return [...entries].sort((a, b) => b.submittedAt - a.submittedAt);
    },
    async record(entry) {
      const next: ActivityEntry = { ...entry, status: "pending", submittedAt: now() };
      entries.push(next);
    },
    async updateStatuses(statuses) {
      for (const [index, entry] of entries.entries()) {
        const status = statuses[entry.hash];
        if (status) {
          entries[index] = { ...entry, status };
        }
      }
      return [...entries].sort((a, b) => b.submittedAt - a.submittedAt);
    },
  };
};

const CSV_HEADER = "submittedAtMs,networkId,accountId,kind,status,hash,summary";

const csvField = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/**
 * Serializes activity entries as CSV for export.
 */
export const activityToCsv = (entries: readonly ActivityEntry[]): string =>
  [
    CSV_HEADER,
    ...entries.map((entry) =>
      [
        String(entry.submittedAt),
        entry.networkId,
        entry.accountId,
        entry.kind,
        entry.status,
        entry.hash,
        csvField(entry.summary),
      ].join(","),
    ),
  ].join("\n");
