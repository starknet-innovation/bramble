/**
 * Local activity log for transactions this wallet submitted. Plain data kept
 * outside the encrypted vault; the clock stays injectable for tests.
 */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import type { KeyValueStore } from "@mc-wallet/store/kv";
import { serializeStoreMutations } from "@mc-wallet/store/mutation";
import { MAX_TRANSACTION_ALERTS_PER_DRAIN } from "@mc-wallet/transactions/alerts";
import { isAccountIdForNetwork } from "@mc-wallet/wallet-model/accounts";
import {
  isStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";

export { activityToCsv } from "./activity-csv";

/**
 * Browser storage key for the activity log.
 */
const ACTIVITY_STORE_KEY = "mc-wallet:activity";
const ACTIVITY_HISTORY_SYNC_KEY = "mc-wallet:activity-history-sync";

const MAX_ENTRIES_PER_SCOPE = 200;
const MAX_SYNC_SCOPES = 50;

/**
 * System wall-clock reader. Lives in this clock-boundary module so other
 * stores (for example origin history) can inject a real clock without
 * touching `Date.now` themselves.
 */
export const systemClock = (): number => Date.now();

/**
 * Lifecycle status of a submitted transaction.
 *
 * `preconfirmed` is provisional: the block proposer executed the transaction
 * (so a revert is already visible) but consensus has not committed its block.
 * `accepted` covers both `ACCEPTED_ON_L2` and `ACCEPTED_ON_L1`; L1 finality is
 * carried by {@link ActivityEntry.finalizedOnL1} instead of a separate status,
 * so the feed never grows a third success tier.
 */
export type ActivityStatus = "accepted" | "pending" | "preconfirmed" | "rejected" | "reverted";

/**
 * Whether a status can still change on chain. Pre-confirmed and pending
 * transactions are both unresolved; `accepted` is a real outcome even though
 * reconciliation keeps watching it until L1 finality. Single source of truth —
 * do not re-derive this comparison at call sites.
 */
export const isUnresolvedActivityStatus = (status: ActivityStatus): boolean =>
  status === "pending" || status === "preconfirmed";

/**
 * Resolves two status observations without allowing stale asynchronous reads
 * to demote chain progress or overwrite a terminal failure.
 */
export const monotonicActivityStatus = (
  current: ActivityStatus,
  observed: ActivityStatus,
): ActivityStatus => {
  const terminal = (status: ActivityStatus): boolean =>
    status === "rejected" || status === "reverted";
  if (terminal(current)) {
    return current;
  }
  if (terminal(observed)) {
    return observed;
  }
  const progress = (status: ActivityStatus): number =>
    status === "accepted" ? 2 : status === "preconfirmed" ? 1 : 0;
  return progress(observed) >= progress(current) ? observed : current;
};

/**
 * One recorded transaction. The `amount`, `counterparty`, and `token` fields
 * are optional so entries stored before they existed still load and export;
 * absent values fall back to blank CSV cells. The three tracking fields below
 * are internal bookkeeping for background reconciliation and are never
 * rendered; they are optional for the same reason.
 */
export type ActivityEntry = {
  readonly accountId: string;
  readonly amount?: string;
  readonly counterparty?: string;
  /**
   * Set to `"pending"` when reconciliation observes a failure the user has
   * already moved past, and flipped to `"delivered"` once the side panel has
   * shown it. Absent means there is nothing to tell the user.
   */
  readonly failureNotice?: "delivered" | "pending";
  /**
   * True once the chain reported `ACCEPTED_ON_L1`. Reconciliation's terminal
   * condition; not a user-visible state.
   */
  readonly finalizedOnL1?: boolean;
  readonly hash: string;
  /**
   * What the account submitted. `"declare"` is its own kind rather than being
   * folded into `"invoke"` so the feed and the CSV export can tell a class
   * declaration apart from a call — they are different transaction types on
   * chain and carry different meaning in an audit.
   */
  readonly kind: "declare" | "deploy" | "invoke" | "transfer";
  readonly networkId: StarknetNetworkId;
  /**
   * Consecutive `TXN_HASH_NOT_FOUND` observations. Reset by any answer that
   * finds the transaction, so ordinary RPC noise never accumulates.
   */
  readonly notFoundCount?: number;
  readonly status: ActivityStatus;
  readonly submittedAt: number;
  readonly summary: string;
  readonly token?: string;
};

/**
 * The reconciled result written back for one hash. Policy (which transition
 * deserves a user-visible notice, when a disappearance counts as failure) is
 * decided by the caller; this store only applies what it is handed.
 */
export type ActivityOutcome = {
  readonly failureNotice?: "pending";
  readonly finalizedOnL1?: boolean;
  readonly notFoundCount?: number;
  readonly status: ActivityStatus;
};

/**
 * Account and network boundary for a single activity feed. Both fields remain
 * explicit so callers cannot accidentally treat an account id as globally
 * scoped if its representation changes in a future vault schema.
 */
export type ActivityScope = {
  readonly accountId: string;
  readonly networkId: StarknetNetworkId;
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
      "failureNotice" | "finalizedOnL1" | "notFoundCount" | "status" | "submittedAt"
    >,
  ) => Promise<void>;
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

const isActivityStatus = (value: unknown): value is ActivityStatus =>
  value === "accepted" ||
  value === "pending" ||
  value === "preconfirmed" ||
  value === "rejected" ||
  value === "reverted";

const isFailureNotice = (value: unknown): value is ActivityEntry["failureNotice"] =>
  value === undefined || value === "delivered" || value === "pending";

const isNotFoundCount = (value: unknown): value is number | undefined =>
  value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);

const isActivityKind = (value: unknown): value is ActivityEntry["kind"] =>
  value === "declare" || value === "deploy" || value === "invoke" || value === "transfer";

const isOptionalDetail = (value: unknown): value is string | undefined =>
  value === undefined || (typeof value === "string" && value.length > 0 && value.length <= 200);

/**
 * Checks stored activity entries before trusting them. The detail fields are
 * optional, so older entries that predate them still validate.
 */
export const isActivityEntry = (value: unknown): value is ActivityEntry =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "accountId",
    "amount",
    "counterparty",
    "failureNotice",
    "finalizedOnL1",
    "hash",
    "kind",
    "networkId",
    "notFoundCount",
    "status",
    "submittedAt",
    "summary",
    "token",
  ]) &&
  isStarknetNetworkId(value["networkId"]) &&
  isAccountIdForNetwork(value["accountId"], value["networkId"]) &&
  typeof value["hash"] === "string" &&
  isStarkFieldElement(value["hash"]) &&
  isActivityKind(value["kind"]) &&
  isActivityStatus(value["status"]) &&
  typeof value["submittedAt"] === "number" &&
  Number.isSafeInteger(value["submittedAt"]) &&
  value["submittedAt"] >= 0 &&
  typeof value["summary"] === "string" &&
  value["summary"].length > 0 &&
  value["summary"].length <= 200 &&
  isOptionalDetail(value["amount"]) &&
  isOptionalDetail(value["counterparty"]) &&
  isOptionalDetail(value["token"]) &&
  isFailureNotice(value["failureNotice"]) &&
  (value["finalizedOnL1"] === undefined || typeof value["finalizedOnL1"] === "boolean") &&
  isNotFoundCount(value["notFoundCount"]);

const readEntries = async (store: KeyValueStore): Promise<readonly ActivityEntry[]> => {
  const stored = await store.get(ACTIVITY_STORE_KEY);
  return Array.isArray(stored) ? stored.filter(isActivityEntry) : [];
};

const matchesScope = (entry: ActivityEntry, scope: ActivityScope): boolean =>
  entry.accountId === scope.accountId && entry.networkId === scope.networkId;

/**
 * Selects the rows that belong to one account on one network. The persistent
 * store may contain many scopes, but no UI or status reconciliation boundary
 * should consume the unfiltered list.
 */
export const activityForScope = (
  entries: readonly ActivityEntry[],
  scope: ActivityScope,
): readonly ActivityEntry[] => entries.filter((entry) => matchesScope(entry, scope));

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
  const next: ActivityEntry = {
    ...entry,
    ...(failureNotice === undefined ? {} : { failureNotice }),
    ...(finalizedOnL1 === undefined ? {} : { finalizedOnL1 }),
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
        const next: ActivityEntry = { ...entry, status: "pending", submittedAt: now() };
        if (!isActivityEntry(next)) {
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
