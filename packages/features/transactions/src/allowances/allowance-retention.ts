/**
 * Which allowance records the log keeps when a bound is reached. Split from
 * ./allowance-store so that module stays a store; everything here is a pure
 * function of the stored entries and the tokens the wallet tracks.
 *
 * Two bounds apply (see `ALLOWANCE_LIMITS`): one per account and network, and
 * one for the whole log. Recency of WRITE is not evidence of liveness, so it
 * never decides which records go on its own. Inside a scope the least risky
 * allowances go first, so an unlimited grant made years ago outlives a stream
 * of one-wei approvals (Sherlock 183); across scopes the fullest scopes give up
 * records first, so one busy account never empties an idle one.
 *
 * Risk is ranked across tokens, not by raw base units, which are not
 * comparable between tokens of different decimals (issue 647). Untracked
 * tokens go first, then tracked tokens by their decimal-normalised amount, and
 * unlimited grants last, whatever their token.
 */
import { canonicalFelt, UINT128_LIMIT } from "@bramble/wallet-model/networks";

/**
 * A uint256 amount at or above this threshold is treated as an effectively
 * unlimited allowance: the conventional max-u128 sentinel, or any value that
 * sets the high 128-bit word, is far beyond a real spend cap. The one shared cut-off — the pre-sign verifier's
 * unlimited-approval risk flag (@bramble/transactions/verify) and the
 * allowance manager's display both read it here, so a transaction flagged
 * before signing is the same one the manager later lists as unlimited. Do not
 * re-derive the `1n << 128n` literal locally — the exponent itself is
 * `UINT128_LIMIT` in @bramble/wallet-model/networks, the same bound the
 * shared uint256 join holds each limb to.
 */
export const UNLIMITED_ALLOWANCE_THRESHOLD = UINT128_LIMIT - 1n;

/**
 * Checks whether a decimal allowance amount should display as unlimited.
 * Non-numeric input is treated as not unlimited so a malformed amount never
 * silently reads as an infinite approval.
 */
export const isUnlimitedAllowance = (amount: string): boolean => {
  try {
    return BigInt(amount) >= UNLIMITED_ALLOWANCE_THRESHOLD;
  } catch {
    return false;
  }
};

/**
 * A token the wallet tracks, as eviction ranking reads it: where it lives and
 * how many decimals its base units carry. Only tokens the account trusts
 * should be passed; anything else ranks as untracked.
 */
export type AllowanceRankToken = {
  readonly address: string;
  readonly decimals: number;
  readonly networkId: string;
};

/**
 * The part of a stored allowance eviction reads: its amount in base units, as
 * a validated decimal string, and the token and network it is held in. A
 * lower bound ranks at its stated figure: it is what the wallet can prove.
 */
type Ranked = { readonly amount: string; readonly networkId: string; readonly token: string };

/**
 * Looks up the decimals of a tracked token for one record, or null when the
 * record's token is not tracked. Built once per write by {@link rankingFor}.
 */
export type AllowanceRanking = (record: Ranked) => number | null;

// Decimals a ranking will scale by; a token claiming more ranks as untracked
// rather than costing an unbounded power of ten.
const MAX_RANK_DECIMALS = 255;

const tokenKey = (networkId: string, address: string): string =>
  `${networkId}|${canonicalFelt(address) ?? address}`;

/**
 * Builds the ranking for one write from the tokens the wallet tracks. With no
 * tokens every record ranks as untracked, which orders by raw amount with
 * unlimited grants last — the order the log used before ranking read tokens.
 */
export const rankingFor = (tokens: readonly AllowanceRankToken[]): AllowanceRanking => {
  const decimals = new Map<string, number>();
  for (const token of tokens) {
    if (
      Number.isSafeInteger(token.decimals) &&
      token.decimals >= 0 &&
      token.decimals <= MAX_RANK_DECIMALS
    ) {
      decimals.set(tokenKey(token.networkId, token.address), token.decimals);
    }
  }
  return (record) => decimals.get(tokenKey(record.networkId, record.token)) ?? null;
};

const UNTRACKED_ONLY: AllowanceRanking = () => null;

// 0: untracked, evicted first; 1: tracked; 2: unlimited, evicted last.
const tierOf = (record: Ranked, decimals: number | null): number =>
  isUnlimitedAllowance(record.amount) ? 2 : decimals === null ? 0 : 1;

// Positive when `left` is the riskier grant. Two tracked grants compare by
// their amounts in whole tokens, cross-multiplied so the comparison stays
// exact: a/10^da against b/10^db is a*10^db against b*10^da. Anything else in
// the same tier compares by raw amount, the only figure the wallet has.
const compareRisk = (left: Ranked, right: Ranked, ranking: AllowanceRanking): number => {
  const leftDecimals = ranking(left);
  const rightDecimals = ranking(right);
  const tier = tierOf(left, leftDecimals) - tierOf(right, rightDecimals);
  if (tier !== 0) {
    return tier;
  }
  const scaled =
    tierOf(left, leftDecimals) === 1 && leftDecimals !== null && rightDecimals !== null;
  const leftReach = BigInt(left.amount) * (scaled ? 10n ** BigInt(rightDecimals) : 1n);
  const rightReach = BigInt(right.amount) * (scaled ? 10n ** BigInt(leftDecimals) : 1n);
  return leftReach === rightReach ? 0 : leftReach > rightReach ? 1 : -1;
};

/**
 * Keeps at most `limit` of `records`, dropping the least risky allowances first
 * (see the module comment) and, among equally risky ones, the oldest written.
 * Order of the kept records is preserved.
 */
export const keepLargest = <T extends Ranked>(
  records: readonly T[],
  limit: number,
  ranking: AllowanceRanking = UNTRACKED_ONLY,
): readonly T[] => {
  if (records.length <= limit) {
    return records;
  }
  // Ranked riskiest first; a stable sort keeps the newer of two equal records
  // ahead because the input is reversed (newest first) before sorting.
  const ranked = [...records].reverse().sort((left, right) => compareRisk(right, left, ranking));
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
 * scopes and, inside each, from its least risky allowances.
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
  ranking: AllowanceRanking = UNTRACKED_ONLY,
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
    for (const record of keepLargest(records, budgets.get(scope) ?? 0, ranking)) {
      kept.add(record);
    }
  }
  return entries.filter((stored) => kept.has(stored));
};
