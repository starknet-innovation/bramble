/**
 * How a revoke finds its target, and how it enters and leaves the allowance
 * log. Split from ./allowance-store so that module stays a store; everything
 * here is a pure function of an id, the stored entries, the chain readings
 * and the revoke transactions' outcomes.
 */
import { isBaseUnitsAmount } from "@bramble/core/json";
import { canonicalFelt, isNonZeroStarkFieldElement } from "@bramble/wallet-model/networks";
import type { AllowanceRecord } from "./allowance-record";

/**
 * Recovers the token and spender an allowance id targets, scoped to a specific
 * account. Returns null unless the id is exactly `<accountId>:<token>:<spender>`
 * with both a non-zero token and spender felt — so an id belonging to another
 * account, or a malformed one, is rejected. Lets a revoke resolve its target
 * from the id alone, covering externally discovered allowances that were never
 * written to the local store.
 */
export const allowanceTarget = (
  id: string,
  accountId: string,
): { readonly spender: string; readonly token: string } | null => {
  const prefix = `${accountId}:`;
  if (!id.startsWith(prefix)) {
    return null;
  }
  const parts = id.slice(prefix.length).split(":");
  if (parts.length !== 2) {
    return null;
  }
  const token = canonicalFelt(parts[0] ?? "");
  const spender = canonicalFelt(parts[1] ?? "");
  if (
    !token ||
    !spender ||
    !isNonZeroStarkFieldElement(token) ||
    !isNonZeroStarkFieldElement(spender)
  ) {
    return null;
  }
  return { spender, token };
};

/**
 * A transaction hash as a record stores it: one canonical non-zero felt, so a
 * hash compares by string equality wherever it is read back.
 */
export const isCanonicalHash = (value: unknown): value is string =>
  typeof value === "string" && isNonZeroStarkFieldElement(value) && canonicalFelt(value) === value;

// An exact zero does not remove the pair (Sherlock 192). Every writer records a
// call once it is submitted, not once it executes, and a revoke that then
// reverts or is rejected leaves the earlier approval standing; deleting the
// record would hide a live grant the user just tried to revoke. The grant is
// kept at its last known amount and marked `revoking` until a chain reading
// of zero confirms the revoke (see `settleRevocations`). Keeping the amount
// also keeps its rank: a pending revoke of an unlimited grant is not the first
// record a full scope evicts. An exact zero for a pair the log never held
// writes nothing: there is no grant here to keep visible.
//
// The revoke's own transaction hash is kept with the mark so its outcome can
// settle it. A newer revoke replaces an older one's hash, and a revoke whose
// hash is unknown drops it: the outcome of a superseded revoke says nothing
// about the one now pending.
/**
 * The record an upsert writes, or null for "write nothing". See the comment
 * above for why an exact zero marks a tracked grant rather than removing it.
 */
export const recordedEntry = (
  entries: readonly AllowanceRecord[],
  next: AllowanceRecord,
  transactionHash: string | undefined,
): AllowanceRecord | null => {
  if (next.amount !== "0" || next.lowerBound) {
    return next;
  }
  const tracked = entries.find((stored) => stored.id === next.id);
  if (!tracked) {
    return null;
  }
  const { revokeHash: _superseded, ...grant } = tracked;
  const hash = transactionHash === undefined ? null : canonicalFelt(transactionHash);
  return {
    ...grant,
    ...(hash !== null && isCanonicalHash(hash) ? { revokeHash: hash } : {}),
    revoking: true as const,
  };
};

/**
 * The settled outcome of one revoke transaction, by its canonical hash, as
 * the wallet's own activity reconciliation observed it: `accepted` once the
 * chain accepted it, `failed` once it was rejected or reverted. A transaction
 * still pending or only pre-confirmed has no outcome yet and is not reported.
 */
export type RevokeOutcome = {
  readonly hash: string;
  readonly status: "accepted" | "failed";
};

// Drops the records a chain reading of zero confirms are gone: a pending
// revoke, and a zero lower bound left by a decrease. A non-zero reading never
// rewrites a record: it cannot tell a revoke the network has not mined yet
// from one that reverted, and a record holding a figure may be ahead of the
// chain (a grant not mined yet), so the display takes the larger of the two
// instead (../allowance-discovery's `withOnChainAmount`).
//
// The revoke's own outcome is what tells those two apart (issue 647), but it
// never deletes a record by itself: only a zero reading does. A revoke that
// failed leaves the grant standing at its recorded amount, so the mark is
// cleared and the row stops saying a revoke is on its way. An accepted revoke
// with no reading keeps its mark until a reading settles it: a failed read is
// not evidence that the allowance is gone.
//
// An accepted revoke with a non-zero reading cannot be told apart from a
// reading a lagging or failed-over node took before the revoke executed. The
// recorded figure is obsolete either way, so the record takes the reading as
// its exact amount and keeps the pending mark (the outcome itself is spent,
// so the hash goes). A genuine re-grant is then listed at the chain's figure,
// and a stale reading is followed by a zero one that drops the record. Clearing
// the mark here instead would leave the pre-revoke figure standing over every
// later zero reading, listing a revoked grant as live.
const settledEntry = (
  stored: AllowanceRecord,
  zeroed: ReadonlySet<string>,
  nonZero: ReadonlyMap<string, string>,
  outcomes: ReadonlyMap<string, RevokeOutcome["status"]>,
): AllowanceRecord | null => {
  const pending = stored.revoking === true;
  if (zeroed.has(stored.id) && (pending || (stored.amount === "0" && stored.lowerBound === true))) {
    return null;
  }
  const outcome = pending && stored.revokeHash ? outcomes.get(stored.revokeHash) : undefined;
  if (outcome === "failed") {
    const { revokeHash: _settled, revoking: _cleared, ...grant } = stored;
    return grant;
  }
  const reading = nonZero.get(stored.id);
  if (outcome === "accepted" && reading !== undefined) {
    const { lowerBound: _resolved, revokeHash: _spent, ...grant } = stored;
    return { ...grant, amount: reading };
  }
  return stored;
};

// A reading adopted as a stored amount must pass the store's own amount rule:
// decimal base units of at most 78 digits.
const isStoredAmount = (amount: string): boolean =>
  isBaseUnitsAmount(amount) && amount.length <= 78;

/**
 * The log after one settling round, or null when nothing changed. Readings
 * are untrusted and only an exact "0" acts on them; outcomes are matched by
 * the hash each pending revoke recorded, so a record with no hash settles on
 * readings alone.
 */
export const entriesAfterSettle = (
  entries: readonly AllowanceRecord[],
  readings: readonly { readonly amount: string; readonly id: string }[],
  outcomes: readonly RevokeOutcome[],
): readonly AllowanceRecord[] | null => {
  const zeroed = new Set(readings.filter((r) => r.amount === "0").map((r) => r.id));
  const nonZero = new Map(
    readings
      .filter((r) => r.amount !== "0" && isStoredAmount(r.amount))
      .map((r) => [r.id, r.amount]),
  );
  const byHash = new Map(outcomes.map((outcome) => [outcome.hash, outcome.status]));
  let changed = false;
  const settled: AllowanceRecord[] = [];
  for (const stored of entries) {
    const next = settledEntry(stored, zeroed, nonZero, byHash);
    changed ||= next !== stored;
    if (next) {
      settled.push(next);
    }
  }
  return changed ? settled : null;
};
