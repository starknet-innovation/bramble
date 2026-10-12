/**
 * Which activity rows the store keeps. Every rule here selects by a field, never
 * by array position: `record` appends while `replaceScope` writes a scope
 * newest-first, so the stored order says nothing about age (Sherlock 203).
 */
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
      unresolved: (rank?.unresolved ?? false) || isUnresolvedActivityStatus(entry.status),
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
  const retainedScope = new Set(
    [...sameScope].sort(newestFirst).slice(0, MAX_ENTRIES_PER_SCOPE - 1),
  );
  return withinScopeLimit(
    [
      ...entries.filter((stored) => !matchesScope(stored, scope) || retainedScope.has(stored)),
      next,
    ],
    scope,
  );
};

/**
 * The validated rows of one scope a `replaceScope` keeps, newest first.
 */
export const scopeSnapshot = (
  entries: readonly ActivityEntry[],
  scope: ActivityScope,
): readonly ActivityEntry[] =>
  entries
    .filter((entry) => isActivityEntry(entry) && matchesScope(entry, scope))
    .sort(newestFirst)
    .slice(0, MAX_ENTRIES_PER_SCOPE);
