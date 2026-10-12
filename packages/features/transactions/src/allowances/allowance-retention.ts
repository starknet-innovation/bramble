/**
 * Which allowance records the log keeps when a bound is reached. Split from
 * ./allowance-store so that module stays a store; everything here is a pure
 * function of the stored entries.
 *
 * Two bounds apply (see `ALLOWANCE_LIMITS`): one per account and network, and
 * one for the whole log. Recency of WRITE is not evidence of liveness, so it
 * never decides which records go on its own. Inside a scope the smallest
 * allowances go first, so an unlimited grant made years ago outlives a stream
 * of one-wei approvals (Sherlock 183); across scopes the fullest scopes give up
 * records first, so one busy account never empties an idle one.
 */

/**
 * The part of a stored allowance eviction reads: its amount in base units, as
 * a validated decimal string. A lower bound ranks at its stated figure: it is
 * what the wallet can prove.
 */
type Ranked = { readonly amount: string };

const reach = (record: Ranked): bigint => BigInt(record.amount);

/**
 * Keeps at most `limit` of `records`, dropping the smallest allowances first and,
 * among equal ones, the oldest written. Order of the kept records is preserved.
 */
export const keepLargest = <T extends Ranked>(
  records: readonly T[],
  limit: number,
): readonly T[] => {
  if (records.length <= limit) {
    return records;
  }
  // Ranked largest first; a stable sort keeps the newer of two equal records
  // ahead because the input is reversed (newest first) before sorting.
  const ranked = [...records]
    .reverse()
    .sort((left, right) =>
      reach(left) === reach(right) ? 0 : reach(left) > reach(right) ? -1 : 1,
    );
  const kept = new Set(ranked.slice(0, limit));
  return records.filter((record) => kept.has(record));
};

// How many entries each scope may keep once the log as a whole has to fit in
// `limit`. Each round levels down every scope currently holding the most, so the
// scopes that caused the overflow pay for it and the survivors end up within one
// entry of an equal share — a scope is never emptied while another still holds a
// full quota. Levelling the whole tallest row (rather than picking one scope by
// name) is what keeps it fair: a tie broken by a fixed rule would send every
// eviction to the same unlucky account until it was empty.
const scopeBudgets = (
  counts: ReadonlyMap<string, number>,
  limit: number,
): ReadonlyMap<string, number> => {
  const budgets = new Map(counts);
  let total = [...budgets.values()].reduce((sum, count) => sum + count, 0);
  while (total > limit) {
    const tallest = Math.max(...budgets.values());
    for (const [scope, count] of budgets) {
      if (count === tallest && total > limit) {
        budgets.set(scope, count - 1);
        total -= 1;
      }
    }
  }
  return budgets;
};

/**
 * Fits the log inside `limit` entries, taking the evictions from the fullest
 * scopes and, inside each, from its smallest allowances.
 *
 * Global age was the trap the per-scope cap only half-closed: with the log
 * full, one account granting allowances all afternoon evicts another account's
 * records one per write until that account reports "no allowances" while still
 * holding live unlimited approvals.
 */
export const trimToTotal = <T extends Ranked>(
  entries: readonly T[],
  limit: number,
  scopeOf: (record: T) => string,
): readonly T[] => {
  if (entries.length <= limit) {
    return entries;
  }
  const byScope = new Map<string, T[]>();
  for (const stored of entries) {
    byScope.set(scopeOf(stored), [...(byScope.get(scopeOf(stored)) ?? []), stored]);
  }
  const budgets = scopeBudgets(
    new Map([...byScope].map(([scope, records]) => [scope, records.length])),
    limit,
  );
  const kept = new Set<T>();
  for (const [scope, records] of byScope) {
    for (const record of keepLargest(records, budgets.get(scope) ?? 0)) {
      kept.add(record);
    }
  }
  return entries.filter((stored) => kept.has(stored));
};
