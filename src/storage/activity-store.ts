/**
 * Local activity log for transactions this wallet submitted. Plain data kept
 * outside the encrypted vault; the clock stays injectable for tests.
 */
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import { MAX_TRANSACTION_ALERTS_PER_DRAIN } from "../shared/transaction-alerts";
import {
  isStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
  sameFelt,
} from "../starknet/networks";
import type { KeyValueStore } from "./kv";
import { serializeStoreMutations } from "./mutation-queue";

/**
 * Browser storage key for the activity log.
 */
const ACTIVITY_STORE_KEY = "mc-wallet:activity";

const MAX_ENTRIES_PER_SCOPE = 200;

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
  readonly kind: "deploy" | "invoke" | "transfer";
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
  readonly list: () => Promise<readonly ActivityEntry[]>;
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
  readonly updateStatuses: (
    outcomes: Readonly<Record<string, ActivityOutcome>>,
    scope: ActivityScope,
  ) => Promise<readonly ActivityEntry[]>;
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
  value === "deploy" || value === "invoke" || value === "transfer";

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
  typeof value["accountId"] === "string" &&
  value["accountId"].length > 0 &&
  typeof value["hash"] === "string" &&
  isStarkFieldElement(value["hash"]) &&
  isActivityKind(value["kind"]) &&
  isStarknetNetworkId(value["networkId"]) &&
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
    ["list"],
  );

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
      entries.splice(0, entries.length, ...entriesAfterRecord(entries, next));
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

const CSV_HEADER =
  "datetime,networkId,accountId,kind,status,amount,token,counterparty,hash,summary";

const csvField = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

const pad = (value: number, width: number): string => value.toString().padStart(width, "0");

/**
 * Formats an epoch-millisecond timestamp as a UTC ISO-8601 string
 * (`YYYY-MM-DDTHH:mm:ss.sssZ`). Implemented as pure integer arithmetic rather
 * than the `Date` constructor so it stays clock-boundary safe: the output
 * depends only on the argument, never on ambient time or locale. The civil
 * date is derived with Howard Hinnant's days-to-year/month/day algorithm.
 */
const toIsoDate = (submittedAt: number): string => {
  const millis = ((submittedAt % 1000) + 1000) % 1000;
  const totalSeconds = Math.floor(submittedAt / 1000);
  const secondOfDay = ((totalSeconds % 86400) + 86400) % 86400;
  const seconds = secondOfDay % 60;
  const minutes = Math.floor(secondOfDay / 60) % 60;
  const hours = Math.floor(secondOfDay / 3600);

  const z = Math.floor(totalSeconds / 86400) + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPart = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPart + 2) / 5) + 1;
  const month = monthPart < 10 ? monthPart + 3 : monthPart - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);

  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}Z`;
};

/**
 * Serializes activity entries as CSV for export. The timestamp is rendered as
 * ISO-8601 and the amount, token, and counterparty are split into their own
 * columns; entries missing those optional fields export blank cells.
 */
export const activityToCsv = (entries: readonly ActivityEntry[]): string =>
  [
    CSV_HEADER,
    ...entries.map((entry) =>
      [
        toIsoDate(entry.submittedAt),
        entry.networkId,
        entry.accountId,
        entry.kind,
        entry.status,
        csvField(entry.amount ?? ""),
        csvField(entry.token ?? ""),
        csvField(entry.counterparty ?? ""),
        entry.hash,
        csvField(entry.summary),
      ].join(","),
    ),
  ].join("\n");
