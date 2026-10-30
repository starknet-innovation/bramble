/**
 * Local activity log for transactions this wallet submitted. Plain data kept
 * outside the encrypted vault; the clock stays injectable for tests.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { recordStorageDiagnostic } from "@bramble/starknet/rpc-diagnostics";
import { type KeyValueStore, storageBudgetFor } from "@bramble/store/kv";
import { serializeStoreMutations } from "@bramble/store/mutation";
import { MAX_TRANSACTION_ALERTS_PER_DRAIN } from "@bramble/transactions/alerts";
import { isAccountIdForNetwork } from "@bramble/wallet-model/accounts";
import { isStarknetNetworkId, sameFelt } from "@bramble/wallet-model/networks";
import {
  type ActivityEntry,
  type ActivityOutcome,
  type ActivityScope,
  activityForScope,
  clampActivitySummary,
  isActivityEntry,
  matchesScope,
  monotonicActivityStatus,
} from "./activity-entry";
import {
  entriesAfterRecord,
  scopeSnapshot,
  withinByteBudget,
  withinScopeLimit,
} from "./activity-retention";

export { activityToCsv } from "./activity-csv";
export {
  type ActivityEntry,
  type ActivityOutcome,
  type ActivityScope,
  type ActivityStatus,
  activityForScope,
  activityOrigin,
  activityToken,
  clampActivitySummary,
  isActivityEntry,
  isUnresolvedActivityStatus,
  MAX_ACTIVITY_TIMESTAMP_MS,
  monotonicActivityStatus,
} from "./activity-entry";

/**
 * Browser storage key for the activity log.
 */
const ACTIVITY_STORE_KEY = "bramble:activity";
const ACTIVITY_HISTORY_SYNC_KEY = "bramble:activity-history-sync";

const MAX_SYNC_SCOPES = 50;

/**
 * System wall-clock reader. Lives in this clock-boundary module so other
 * stores (for example origin history) can inject a real clock without
 * touching `Date.now` themselves.
 */
export const systemClock = (): number => Date.now();

/** A row as a caller records it; the log sets status, time and outcomes. */
export type NewActivityEntry = Omit<
  ActivityEntry,
  | "failureNotice"
  | "feePaid"
  | "finalizedOnL1"
  | "notFoundCount"
  | "seenOnChain"
  | "status"
  | "submittedAt"
>;

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
  readonly record: (entry: NewActivityEntry) => Promise<void>;
  /**
   * Records `entry` only when no row of any account already carries its hash;
   * the check and the write are one serialized mutation, so overlapping calls
   * for one hash write it once. True when it wrote the row, false when a row
   * already held the hash (that row is left untouched). Rejects when the log
   * cannot be read or written.
   */
  readonly recordIfAbsent: (entry: NewActivityEntry) => Promise<boolean>;
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

/**
 * Last on-chain history attempt retained for one account scope.
 */
export type ActivityHistoryState = { readonly syncedAt: number; readonly unavailable: boolean };
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

// Every write of the log goes through here: it is trimmed to its storage
// budget first, so a log that outgrew it (a v0.10.5 log read by a release with
// larger rows) becomes writable again instead of refusing every write. A
// trimmed or failed write is counted in the opt-in diagnostics, because most
// callers absorb the failure so it cannot replace a chain outcome.
const writeEntries = async (
  store: KeyValueStore,
  entries: readonly ActivityEntry[],
  kept?: ActivityEntry,
): Promise<readonly ActivityEntry[]> => {
  const fitted = withinByteBudget(entries, storageBudgetFor(ACTIVITY_STORE_KEY), kept);
  if (fitted !== entries) {
    recordStorageDiagnostic("activity", "trimmed");
  }
  try {
    await store.set(ACTIVITY_STORE_KEY, fitted);
  } catch (error) {
    recordStorageDiagnostic("activity", "write-failed");
    throw error;
  }
  return fitted;
};

const outcomeForHash = (
  outcomes: Readonly<Record<string, ActivityOutcome>>,
  hash: string,
): ActivityOutcome | undefined =>
  Object.entries(outcomes).find(([candidate]) => sameFelt(candidate, hash))?.[1];

// A recorded fee is final: a later read never replaces it, so an outcome's fee
// lands only on an entry that has none. A sponsored row never takes one: its
// receipt fee was the sponsor's, never the account's.
const recordedFee = (
  entry: ActivityEntry,
  outcome: ActivityOutcome,
): Pick<ActivityEntry, "feePaid"> =>
  entry.feePayer !== "sponsor" && entry.feePaid === undefined && outcome.feePaid !== undefined
    ? { feePaid: outcome.feePaid }
    : {};

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
    ...recordedFee(entry, outcome),
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

// A recorded row: pending, stamped now, its summary clamped.
const newEntry = (entry: NewActivityEntry, submittedAt: number): ActivityEntry => ({
  ...entry,
  status: "pending",
  submittedAt,
  summary: clampActivitySummary(entry.summary),
});

// Whether any row, of any account, carries `hash`.
const holdsHash = (entries: readonly ActivityEntry[], hash: string): boolean =>
  entries.some((entry) => sameFelt(entry.hash, hash));

/**
 * Creates the persistent activity log.
 */
export const createActivityLog = ({
  now = () => Date.now(),
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
        const next = newEntry(entry, now());
        if (!isActivityEntry(next)) {
          return;
        }
        const entries = await readEntries(store);
        await writeEntries(store, entriesAfterRecord(entries, next), next);
      },
      async recordIfAbsent(entry) {
        const next = newEntry(entry, now());
        const entries = await readEntries(store);
        if (!isActivityEntry(next) || holdsHash(entries, next.hash)) {
          return false;
        }
        await writeEntries(store, entriesAfterRecord(entries, next), next);
        return true;
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
        const scoped = scopeSnapshot(entries, scope);
        const stored = new Set(
          await writeEntries(
            store,
            withinScopeLimit(
              [
                ...(await readEntries(store)).filter((entry) => !matchesScope(entry, scope)),
                ...scoped,
              ],
              scope,
            ),
          ),
        );
        return scoped.filter((entry) => stored.has(entry));
      },
      async takeFailureNotices(scope) {
        const { delivered, next } = drainFailureNotices(await readEntries(store), scope);
        if (delivered.length > 0) {
          await writeEntries(store, next);
        }
        return delivered;
      },
      async updateStatuses(outcomes, scope) {
        const updated = await writeEntries(
          store,
          reconciled(await readEntries(store), outcomes, scope),
        );
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
      entries.splice(0, entries.length, ...entriesAfterRecord(entries, newEntry(entry, now())));
    },
    async recordIfAbsent(entry) {
      const next = newEntry(entry, now());
      if (holdsHash(entries, next.hash)) return false;
      entries.splice(0, entries.length, ...entriesAfterRecord(entries, next));
      return true;
    },
    async markHistorySynced(scope, syncedAt, unavailable) {
      historySyncs.set(scopeKey(scope), { syncedAt, unavailable });
    },
    async replaceScope(next, scope) {
      const scoped = scopeSnapshot(next, scope);
      entries.splice(
        0,
        entries.length,
        ...withinScopeLimit(
          [...entries.filter((entry) => !matchesScope(entry, scope)), ...scoped],
          scope,
        ),
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
