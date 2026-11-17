/**
 * Which activity rows the store keeps. Every rule here selects by a field, never
 * by array position: `record` appends while `replaceScope` writes a scope
 * newest-first, so the stored order says nothing about age (Sherlock 203).
 */
import { isJsonWithinBudget, type JsonBudget } from "@bramble/core/json";
import { sameFelt } from "@bramble/wallet-model/networks";
import {
  type ActivityEntry,
  type ActivityScope,
  activityForScope,
  isActivityEntry,
  isUnresolvedActivityStatus,
  matchesScope,
} from "./activity-entry";

/** Rows kept for one account on one network. */
export const MAX_ENTRIES_PER_SCOPE = 200;

/**
 * Account/network scopes kept in the log, so the whole log is bounded at
 * `MAX_ACTIVITY_SCOPES * MAX_ENTRIES_PER_SCOPE` rows (Sherlock 158). Every
 * reconciliation tick reads and rewrites the whole log, so without it the cost
 * of a tick grew with every account ever used.
 */
export const MAX_ACTIVITY_SCOPES = 50;

const newestFirst = (left: ActivityEntry, right: ActivityEntry): number =>
  right.submittedAt - left.submittedAt;

// A row still owed to the user: a failure notice not yet shown, or a
// transaction still under observation. A retired row whose notice was already
// delivered keeps its unresolved status (the wallet never learned the outcome)
// but is owed nothing, so it no longer outranks settled rows (#677).
const isOwed = (entry: ActivityEntry): boolean =>
  entry.failureNotice === "pending" ||
  (isUnresolvedActivityStatus(entry.status) && entry.failureNotice === undefined);

// Every owed row before any other, then the newest: which rows a scope keeps
// under its count cap.
const keepOrder = (left: ActivityEntry, right: ActivityEntry): number =>
  isOwed(left) === isOwed(right) ? newestFirst(left, right) : isOwed(left) ? -1 : 1;

const scopeKey = (scope: ActivityScope): string => `${scope.networkId}\u0000${scope.accountId}`;

// How much a scope is worth keeping: one still observing a transaction outranks
// every settled one, and among equals the scope used most recently wins.
type ScopeRank = { readonly newest: number; readonly unresolved: boolean };

const outranks = (left: ScopeRank, right: ScopeRank): number =>
  left.unresolved === right.unresolved ? right.newest - left.newest : left.unresolved ? -1 : 1;

/**
 * Drops whole scopes past {@link MAX_ACTIVITY_SCOPES}. The scope just written
 * is always kept. The others are ranked so that a scope still holding an
 * unresolved transaction is evicted only after every settled scope, and then
 * by the age of its newest row.
 */
export const withinScopeLimit = (
  entries: readonly ActivityEntry[],
  written: ActivityScope,
): readonly ActivityEntry[] => {
  const ranks = new Map<string, ScopeRank>();
  for (const entry of entries) {
    const key = scopeKey(entry);
    const rank = ranks.get(key);
    ranks.set(key, {
      newest: Math.max(rank?.newest ?? 0, entry.submittedAt),
      unresolved: (rank?.unresolved ?? false) || isOwed(entry),
    });
  }
  if (ranks.size <= MAX_ACTIVITY_SCOPES) {
    return entries;
  }
  const writtenKey = scopeKey(written);
  const kept = new Set(
    [...ranks]
      .filter(([key]) => key !== writtenKey)
      .sort(([, left], [, right]) => outranks(left, right))
      .slice(0, MAX_ACTIVITY_SCOPES - 1)
      .map(([key]) => key),
  );
  kept.add(writtenKey);
  return entries.filter((entry) => kept.has(scopeKey(entry)));
};

/**
 * The log after recording `next`: the scope keeps its newest
 * `MAX_ENTRIES_PER_SCOPE - 1` other rows by `submittedAt`, plus `next`, which
 * replaces any stored row for the same hash.
 */
export const entriesAfterRecord = (
  entries: readonly ActivityEntry[],
  next: ActivityEntry,
): readonly ActivityEntry[] => {
  const scope = { accountId: next.accountId, networkId: next.networkId };
  const sameScope = activityForScope(entries, scope).filter(
    (stored) => !sameFelt(stored.hash, next.hash),
  );
  const retainedScope = new Set([...sameScope].sort(keepOrder).slice(0, MAX_ENTRIES_PER_SCOPE - 1));
  return withinScopeLimit(
    [
      ...entries.filter((stored) => !matchesScope(stored, scope) || retainedScope.has(stored)),
      next,
    ],
    scope,
  );
};

/**
 * The validated rows of one scope a `replaceScope` keeps, newest first: every
 * owed row before any other, then the newest, up to the count cap.
 */
export const scopeSnapshot = (
  entries: readonly ActivityEntry[],
  scope: ActivityScope,
): readonly ActivityEntry[] =>
  entries
    .filter((entry) => isActivityEntry(entry) && matchesScope(entry, scope))
    .sort(keepOrder)
    .slice(0, MAX_ENTRIES_PER_SCOPE)
    .sort(newestFirst);

// A row still owed to the user (see isOwed) is evicted only after every other row.
const evictionOrder = (left: ActivityEntry, right: ActivityEntry): number =>
  isOwed(left) === isOwed(right) ? left.submittedAt - right.submittedAt : isOwed(left) ? 1 : -1;

/**
 * The log trimmed to what its storage key admits. The row caps above bound the
 * row count, not the bytes: rows vary in size and gained fields over releases,
 * so a log within the caps can still exceed `budget`, and every later write
 * would then fail (release audit N1). Rows are evicted oldest settled first;
 * a row still observing a transaction or owing a failure notice goes only once
 * every settled row has, and `kept` (the row just recorded) never does. Returns
 * `entries` itself when it already fits. A log that still cannot fit is
 * returned as trimmed as it gets, so the store's own budget check refuses it.
 */
export const withinByteBudget = (
  entries: readonly ActivityEntry[],
  budget: JsonBudget,
  kept?: ActivityEntry,
): readonly ActivityEntry[] => {
  // Not the type guard itself: a failed guard would narrow `entries` away.
  const fits = (rows: readonly ActivityEntry[]): boolean => isJsonWithinBudget(rows, budget);
  if (fits(entries)) {
    return entries;
  }
  const evictable = entries.filter((entry) => entry !== kept).sort(evictionOrder);
  const without = (count: number): readonly ActivityEntry[] => {
    const evicted = new Set(evictable.slice(0, count));
    return entries.filter((entry) => !evicted.has(entry));
  };
  // Evicting more rows never grows the log, so the fewest evictions that fit
  // is found by bisection rather than one re-measure per row.
  let low = 1;
  let high = evictable.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (fits(without(middle))) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return without(high);
};
