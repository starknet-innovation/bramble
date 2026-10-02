/**
 * Local activity log for transactions this wallet submitted. Plain data kept
 * outside the encrypted vault; the clock stays injectable for tests.
 *
 * This public module owns the clock boundary and the persistent store. The
 * entry model lives in `./activity-model` and is re-exported here so callers
 * keep importing `@bramble/transactions/activity`.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type { KeyValueStore } from "@bramble/store/kv";
import { serializeStoreMutations } from "@bramble/store/mutation";
import { MAX_TRANSACTION_ALERTS_PER_DRAIN } from "@bramble/transactions/alerts";
import { isAccountIdForNetwork } from "@bramble/wallet-model/accounts";
import {
  isStarknetNetworkId,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import {
  type ActivityEntry,
  type ActivityHistoryState,
  type ActivityOutcome,
  type ActivityScope,
  activityForScope,
  isActivityEntry,
  matchesScope,
  monotonicActivityStatus,
} from "./activity-model";
import type { Snip9RelayDetail } from "./relay-detail";

export { activityToCsv } from "./activity-csv";
export {
  type ActivityEntry,
  type ActivityHistoryState,
  type ActivityOutcome,
  type ActivityScope,
  type ActivityStatus,
  activityForScope,
  isActivityEntry,
  isUnresolvedActivityStatus,
  monotonicActivityStatus,
} from "./activity-model";

/**
 * Browser storage key for the activity log.
 */
const ACTIVITY_STORE_KEY = "bramble:activity";
const ACTIVITY_HISTORY_SYNC_KEY = "bramble:activity-history-sync";

const MAX_ENTRIES_PER_SCOPE = 200;
const MAX_SYNC_SCOPES = 50;

/**
 * System wall-clock reader. Lives in this clock-boundary module so other
 * stores (for example origin history) can inject a real clock without
 * touching `Date.now` themselves.
 */
export const systemClock = (): number => Date.now();

/**
 * The parts a caller supplies to record a locally signed SNIP-9
 * `OutsideExecution`. `hash` is the canonical SNIP-12 message hash the signed
 * message committed to, and is also the dedup key; `snip9.messageHash` must
 * carry the same value so the stored row revalidates.
 */
export type RelaySignatureRecord = {
  readonly accountId: string;
  readonly hash: string;
  readonly networkId: StarknetNetworkId;
  readonly snip9: Snip9RelayDetail;
  readonly summary: string;
};

/**
 * Activity log surface used by background message handling.
 */
export type ActivityLog = {
  /** Last explorer history attempt for one public account scope. */
  readonly historySync?: (scope: ActivityScope) => Promise<ActivityHistoryState | null>;
  readonly list: () => Promise<readonly ActivityEntry[]>;
  /** Records an explorer attempt without touching activity rows. */
  readonly markHistorySynced?: (
    scope: ActivityScope,
    syncedAt: number,
    unavailable: boolean,
  ) => Promise<void>;
  readonly record: (
    entry: Omit<
      ActivityEntry,
      "failureNotice" | "finalizedOnL1" | "notFoundCount" | "seenOnChain" | "status" | "submittedAt"
    >,
  ) => Promise<void>;
  /**
   * Records a locally signed SNIP-9 `OutsideExecution` as an accepted
   * `"relay-signed"` row, deduplicated by its message hash. Optional only so
   * narrow injected test doubles remain compatible; persistent stores and the
   * in-memory test default implement it.
   */
  readonly recordRelaySignature?: (entry: RelaySignatureRecord) => Promise<void>;
  /**
   * Atomically returns the entries carrying an undelivered failure notice and
   * marks them delivered, so a notice surfaces exactly once even if two panels
   * drain concurrently. Delivery is scoped to one account/network and bounded
   * per refresh.
   */
  readonly takeFailureNotices: (scope: ActivityScope) => Promise<readonly ActivityEntry[]>;
  /**
   * Replaces one scope with a validated merged local/on-chain snapshot. Optional
   * only so narrow injected test doubles remain compatible; persistent stores
   * implement it so discovered history survives future offline opens.
   */
  readonly replaceScope?: (
    entries: readonly ActivityEntry[],
    scope: ActivityScope,
  ) => Promise<readonly ActivityEntry[]>;
  readonly updateStatuses: (
    outcomes: Readonly<Record<string, ActivityOutcome>>,
    scope: ActivityScope,
  ) => Promise<readonly ActivityEntry[]>;
};

type ActivityHistorySync = ActivityHistoryState & ActivityScope;

const isHistorySync = (value: unknown): value is ActivityHistorySync =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountId", "networkId", "syncedAt", "unavailable"]) &&
  isStarknetNetworkId(value["networkId"]) &&
  isAccountIdForNetwork(value["accountId"], value["networkId"]) &&
  typeof value["syncedAt"] === "number" &&
  Number.isSafeInteger(value["syncedAt"]) &&
  value["syncedAt"] >= 0 &&
  typeof value["unavailable"] === "boolean";

const readHistorySyncs = async (store: KeyValueStore): Promise<readonly ActivityHistorySync[]> => {
  const stored = await store.get(ACTIVITY_HISTORY_SYNC_KEY);
  return Array.isArray(stored) ? stored.filter(isHistorySync).slice(-MAX_SYNC_SCOPES) : [];
};

const readEntries = async (store: KeyValueStore): Promise<readonly ActivityEntry[]> => {
  const stored = await store.get(ACTIVITY_STORE_KEY);
  return Array.isArray(stored) ? stored.filter(isActivityEntry) : [];
};

const entriesAfterRecord = (
  entries: readonly ActivityEntry[],
  next: ActivityEntry,
): readonly ActivityEntry[] => {
  const scope = { accountId: next.accountId, networkId: next.networkId };
  const sameScope = activityForScope(entries, scope).filter(
    (stored) => !sameFelt(stored.hash, next.hash),
  );
  const retainedScope = new Set(sameScope.slice(-(MAX_ENTRIES_PER_SCOPE - 1)));
  return [
    ...entries.filter(
      (stored) =>
        !matchesScope(stored, scope) ||
        (!sameFelt(stored.hash, next.hash) && retainedScope.has(stored)),
    ),
    next,
  ];
};

const outcomeForHash = (
  outcomes: Readonly<Record<string, ActivityOutcome>>,
  hash: string,
): ActivityOutcome | undefined =>
  Object.entries(outcomes).find(([candidate]) => sameFelt(candidate, hash))?.[1];

// Merges one reconciled outcome into a stored entry. Absent optional fields are
// dropped rather than written as `undefined`, so the persisted record stays
// JSON-clean and revalidates; a merge that would not revalidate is discarded.
const applyOutcome = (entry: ActivityEntry, outcome: ActivityOutcome): ActivityEntry => {
  const status = monotonicActivityStatus(entry.status, outcome.status);
  const failureNotice =
    entry.failureNotice === "delivered"
      ? "delivered"
      : (outcome.failureNotice ?? entry.failureNotice);
  const finalizedOnL1 =
    entry.finalizedOnL1 === true ? true : (outcome.finalizedOnL1 ?? entry.finalizedOnL1);
  const seenOnChain =
    entry.seenOnChain === true ? true : (outcome.seenOnChain ?? entry.seenOnChain);
  const next: ActivityEntry = {
    ...entry,
    ...(failureNotice === undefined ? {} : { failureNotice }),
    ...(finalizedOnL1 === undefined ? {} : { finalizedOnL1 }),
    ...(seenOnChain === undefined ? {} : { seenOnChain }),
    ...(outcome.notFoundCount === undefined ? {} : { notFoundCount: outcome.notFoundCount }),
    status,
  };
  return isActivityEntry(next) ? next : entry;
};

const reconciled = (
  entries: readonly ActivityEntry[],
  outcomes: Readonly<Record<string, ActivityOutcome>>,
  scope: ActivityScope,
): readonly ActivityEntry[] =>
  entries.map((entry) => {
    if (!matchesScope(entry, scope)) {
      return entry;
    }
    const outcome = outcomeForHash(outcomes, entry.hash);
    return outcome ? applyOutcome(entry, outcome) : entry;
  });

// Splits the log into the notices owed to the user and the log with those
// notices marked delivered.
const drainFailureNotices = (
  entries: readonly ActivityEntry[],
  scope: ActivityScope,
): {
  readonly delivered: readonly ActivityEntry[];
  readonly next: readonly ActivityEntry[];
} => {
  const delivered = entries
    .filter((entry) => matchesScope(entry, scope) && entry.failureNotice === "pending")
    .slice(0, MAX_TRANSACTION_ALERTS_PER_DRAIN);
  const deliveredEntries = new Set(delivered);
  return {
    delivered,
    next: entries.map((entry) =>
      deliveredEntries.has(entry) ? { ...entry, failureNotice: "delivered" as const } : entry,
    ),
  };
};

// Builds the accepted row a signed OutsideExecution is journalled as. Returns
// null when the assembled row would not revalidate, so a malformed input never
// reaches storage.
const relaySignedEntry = (
  entry: RelaySignatureRecord,
  submittedAt: number,
): ActivityEntry | null => {
  const next: ActivityEntry = { ...entry, kind: "relay-signed", status: "accepted", submittedAt };
  return isActivityEntry(next) ? next : null;
};

/**
 * Creates the persistent activity log.
 */
export const createActivityLog = ({
  now = systemClock,
  store,
}: {
  readonly now?: () => number;
  readonly store: KeyValueStore;
}): ActivityLog =>
  serializeStoreMutations<ActivityLog>(
    {
      async historySync(scope) {
        const sync = (await readHistorySyncs(store)).find(
          (entry) => entry.accountId === scope.accountId && entry.networkId === scope.networkId,
        );
        return sync ? { syncedAt: sync.syncedAt, unavailable: sync.unavailable } : null;
      },
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
        await store.set(ACTIVITY_STORE_KEY, entriesAfterRecord(entries, next));
      },
      async recordRelaySignature(entry) {
        const next = relaySignedEntry(entry, now());
        if (!next) {
          return;
        }
        const entries = await readEntries(store);
        await store.set(ACTIVITY_STORE_KEY, entriesAfterRecord(entries, next));
      },
      async markHistorySynced(scope, syncedAt, unavailable) {
        const next = { ...scope, syncedAt, unavailable };
        if (!isHistorySync(next)) return;
        const retained = (await readHistorySyncs(store)).filter(
          (entry) => entry.accountId !== scope.accountId || entry.networkId !== scope.networkId,
        );
        await store.set(ACTIVITY_HISTORY_SYNC_KEY, [...retained, next].slice(-MAX_SYNC_SCOPES));
      },
      async replaceScope(entries, scope) {
        const scoped = entries
          .filter((entry) => isActivityEntry(entry) && matchesScope(entry, scope))
          .sort((left, right) => right.submittedAt - left.submittedAt)
          .slice(0, MAX_ENTRIES_PER_SCOPE);
        await store.set(ACTIVITY_STORE_KEY, [
          ...(await readEntries(store)).filter((entry) => !matchesScope(entry, scope)),
          ...scoped,
        ]);
        return scoped;
      },
      async takeFailureNotices(scope) {
        const { delivered, next } = drainFailureNotices(await readEntries(store), scope);
        if (delivered.length > 0) {
          await store.set(ACTIVITY_STORE_KEY, next);
        }
        return delivered;
      },
      async updateStatuses(outcomes, scope) {
        const updated = reconciled(await readEntries(store), outcomes, scope);
        await store.set(ACTIVITY_STORE_KEY, updated);
        return [...activityForScope(updated, scope)].sort((a, b) => b.submittedAt - a.submittedAt);
      },
    },
    ["historySync", "list"],
  );

/**
 * In-memory activity log used as the test default.
 */
export const memoryActivityLog = (now: () => number = () => 0): ActivityLog => {
  const entries: ActivityEntry[] = [];
  const historySyncs = new Map<string, ActivityHistoryState>();
  const scopeKey = (scope: ActivityScope): string => `${scope.networkId}:${scope.accountId}`;
  return {
    async historySync(scope) {
      return historySyncs.get(scopeKey(scope)) ?? null;
    },
    async list() {
      return [...entries].sort((a, b) => b.submittedAt - a.submittedAt);
    },
    async record(entry) {
      const next: ActivityEntry = { ...entry, status: "pending", submittedAt: now() };
      entries.splice(0, entries.length, ...entriesAfterRecord(entries, next));
    },
    async recordRelaySignature(entry) {
      const next = relaySignedEntry(entry, now());
      if (!next) {
        return;
      }
      entries.splice(0, entries.length, ...entriesAfterRecord(entries, next));
    },
    async markHistorySynced(scope, syncedAt, unavailable) {
      historySyncs.set(scopeKey(scope), { syncedAt, unavailable });
    },
    async replaceScope(next, scope) {
      const scoped = next
        .filter((entry) => isActivityEntry(entry) && matchesScope(entry, scope))
        .sort((left, right) => right.submittedAt - left.submittedAt)
        .slice(0, MAX_ENTRIES_PER_SCOPE);
      entries.splice(
        0,
        entries.length,
        ...entries.filter((entry) => !matchesScope(entry, scope)),
        ...scoped,
      );
      return scoped;
    },
    async takeFailureNotices(scope) {
      const { delivered, next } = drainFailureNotices(entries, scope);
      entries.splice(0, entries.length, ...next);
      return delivered;
    },
    async updateStatuses(outcomes, scope) {
      entries.splice(0, entries.length, ...reconciled(entries, outcomes, scope));
      return [...activityForScope(entries, scope)].sort((a, b) => b.submittedAt - a.submittedAt);
    },
  };
};
