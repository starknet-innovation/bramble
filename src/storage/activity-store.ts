/**
 * Local activity log for transactions this wallet submitted. Plain data kept
 * outside the encrypted vault; the clock stays injectable for tests.
 */
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
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
 */
export type ActivityStatus = "accepted" | "pending" | "rejected" | "reverted";

/**
 * One recorded transaction. The `amount`, `counterparty`, and `token` fields
 * are optional so entries stored before they existed still load and export;
 * absent values fall back to blank CSV cells.
 */
export type ActivityEntry = {
  readonly accountId: string;
  readonly amount?: string;
  readonly counterparty?: string;
  readonly hash: string;
  readonly kind: "deploy" | "invoke" | "transfer";
  readonly networkId: StarknetNetworkId;
  readonly status: ActivityStatus;
  readonly submittedAt: number;
  readonly summary: string;
  readonly token?: string;
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
  readonly record: (entry: Omit<ActivityEntry, "status" | "submittedAt">) => Promise<void>;
  readonly updateStatuses: (
    statuses: Readonly<Record<string, ActivityStatus>>,
    scope: ActivityScope,
  ) => Promise<readonly ActivityEntry[]>;
};

const isActivityStatus = (value: unknown): value is ActivityStatus =>
  value === "accepted" || value === "pending" || value === "rejected" || value === "reverted";

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
    "hash",
    "kind",
    "networkId",
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
  isOptionalDetail(value["token"]);

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

const statusForHash = (
  statuses: Readonly<Record<string, ActivityStatus>>,
  hash: string,
): ActivityStatus | undefined =>
  Object.entries(statuses).find(([candidate]) => sameFelt(candidate, hash))?.[1];

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
      async updateStatuses(statuses, scope) {
        const entries = await readEntries(store);
        const updated = entries.map((entry) => {
          if (!matchesScope(entry, scope)) {
            return entry;
          }
          const status = statusForHash(statuses, entry.hash);
          return status && isActivityStatus(status) && status !== entry.status
            ? { ...entry, status }
            : entry;
        });
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
    async updateStatuses(statuses, scope) {
      for (const [index, entry] of entries.entries()) {
        if (!matchesScope(entry, scope)) {
          continue;
        }
        const status = statusForHash(statuses, entry.hash);
        if (status) {
          entries[index] = { ...entry, status };
        }
      }
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
