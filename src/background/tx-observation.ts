/**
 * Pure policy for how long, and how often, the wallet keeps watching a
 * submitted transaction, and which chain answers deserve to interrupt the user.
 *
 * Starknet's pre-confirmed status lets the wallet advance the send journey in
 * hundreds of milliseconds, but a pre-confirmed transaction is provisional and
 * an L2-accepted one can still be dropped by a deep reorg. Observation
 * therefore runs until `ACCEPTED_ON_L1`, in two cadences, and every decision
 * here is a function of the stored entry, the chain report, and an injected
 * clock — no timers, storage, or ambient time.
 */

import type { TransactionStatusReport } from "../starknet/rpc";
import type { ActivityEntry, ActivityOutcome, ActivityStatus } from "../storage/activity-store";
import { isUnresolvedActivityStatus, monotonicActivityStatus } from "../storage/activity-store";

/**
 * Consecutive `TXN_HASH_NOT_FOUND` answers required before a transaction the
 * wallet already saw on chain is treated as gone. A pre-confirmed transaction
 * disappears exactly this way when its block proposal fails to commit, but a
 * single miss is ordinary node noise, so the wallet matches starknet.js's
 * three-observation precedent rather than alarming on the first one.
 */
export const NOT_FOUND_FAILURE_THRESHOLD = 3;

/**
 * How long a still-unresolved (pending or pre-confirmed) transaction stays
 * under observation. Starknet builds blocks in seconds, so an hour is roughly
 * two orders of magnitude of headroom; past it the wallet stops polling and
 * tells the user it could not confirm the transaction rather than spinning
 * forever.
 */
export const UNRESOLVED_WINDOW_MS = 60 * 60 * 1_000;

/**
 * How long an L2-accepted transaction stays under observation while it waits
 * for L1 proof. Mainnet state updates land on L1 every few hours; seven days is
 * more than twenty times the worst cadence seen in practice and bounds a
 * transaction that will never be proven.
 */
export const L1_FINALITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * Observation cadences. Unresolved transactions are polled every minute (the
 * shortest period Chrome honours for a packed extension's alarm); L2-accepted
 * transactions waiting on L1 are polled every quarter hour, because their
 * answer changes on an hours-long scale and polling them hot for hours would
 * burn the user's network for nothing.
 */
export const FAST_OBSERVATION_PERIOD_MINUTES = 1;
/**
 * Cadence for L2-accepted transactions still awaiting L1 proof.
 */
export const SLOW_OBSERVATION_PERIOD_MINUTES = 15;

/**
 * Which cadence an entry belongs to, or `null` when the wallet is done with it.
 * Terminal states — `rejected`, `reverted`, and L1-final `accepted` — are never
 * observed again.
 */
export type ObservationTier = "fast" | "slow";

const tierFor = (entry: ActivityEntry): ObservationTier | null => {
  if (isUnresolvedActivityStatus(entry.status)) {
    return "fast";
  }
  return entry.status === "accepted" && entry.finalizedOnL1 !== true ? "slow" : null;
};

const windowFor = (tier: ObservationTier): number =>
  tier === "fast" ? UNRESOLVED_WINDOW_MS : L1_FINALITY_WINDOW_MS;

/**
 * Decides whether one entry is still worth polling on the given cadence.
 * `nowMs` is injected so this stays a pure function of its inputs.
 */
export const isObservedAt = (entry: ActivityEntry, tier: ObservationTier, nowMs: number): boolean =>
  tierFor(entry) === tier && nowMs - entry.submittedAt < windowFor(tier);

/**
 * Whether an entry is due for a chain read on either cadence. Used by the
 * user-initiated activity refresh, which polls everything still worth polling
 * rather than waiting for the background cadence to come round.
 */
export const isObserved = (entry: ActivityEntry, nowMs: number): boolean =>
  isObservedAt(entry, "fast", nowMs) || isObservedAt(entry, "slow", nowMs);

/**
 * What to persist for a retired entry: the notice it owes the user, and its
 * status deliberately left untouched — the wallet genuinely does not know the
 * outcome, and claiming a terminal state it never observed would be a lie.
 */
export const retiredOutcome = (entry: ActivityEntry): ActivityOutcome => ({
  failureNotice: "pending",
  status: entry.status,
});

/**
 * Selects the entries that have outlived their observation window without ever
 * resolving. These are retired: the wallet stops polling them and owes the user
 * one notice, since it advanced the send journey on a pre-confirmation that
 * never became final.
 */
export const expiredObservations = (
  entries: readonly ActivityEntry[],
  nowMs: number,
): readonly ActivityEntry[] =>
  entries.filter(
    (entry) =>
      entry.failureNotice === undefined &&
      isUnresolvedActivityStatus(entry.status) &&
      nowMs - entry.submittedAt >= UNRESOLVED_WINDOW_MS,
  );

// A failing outcome only interrupts the user when the send journey had already
// advanced past the confirmation screen on the strength of a chain answer, and
// only once per transaction: the Send flow toasts its own immediate failures,
// and a delivered notice must not re-fire on every later poll.
const owesNotice = (entry: ActivityEntry, next: ActivityStatus): boolean =>
  entry.failureNotice === undefined &&
  next !== entry.status &&
  (entry.status === "accepted" || entry.status === "preconfirmed") &&
  (next === "rejected" || next === "reverted");

const withNotice = (entry: ActivityEntry, outcome: ActivityOutcome): ActivityOutcome =>
  owesNotice(entry, outcome.status) ? { ...outcome, failureNotice: "pending" } : outcome;

// A hash the node has no record of. Below the threshold this is treated as
// noise and only the tally moves; at the threshold the transaction is gone —
// its block proposal never committed — which is a rejection, not a revert.
const disappearedOutcome = (entry: ActivityEntry): ActivityOutcome => {
  const notFoundCount = (entry.notFoundCount ?? 0) + 1;
  return notFoundCount < NOT_FOUND_FAILURE_THRESHOLD
    ? { notFoundCount, status: entry.status }
    : withNotice(entry, { notFoundCount, status: "rejected" });
};

/**
 * Folds one chain report into the outcome to persist for an entry.
 *
 * Any answer that finds the transaction clears the not-found tally, so
 * intermittent misses never accumulate into a false failure. Progress and L1
 * finality are monotonic: a lagging failover node cannot move an accepted
 * transaction back to pre-confirmed/pending or erase observed L1 finality.
 */
export const reconciledOutcome = (
  entry: ActivityEntry,
  report: TransactionStatusReport,
): ActivityOutcome => {
  if (!report.found) {
    return disappearedOutcome(entry);
  }
  const status = monotonicActivityStatus(entry.status, report.status);
  return withNotice(entry, {
    finalizedOnL1: entry.finalizedOnL1 === true || report.finalizedOnL1,
    notFoundCount: 0,
    status,
  });
};

/**
 * User-facing copy for one owed failure notice. Written for someone who has
 * already left the send screen and needs to know what changed and what is safe
 * to assume about their balance.
 */
export const failureNoticeMessage = (entry: ActivityEntry): string => {
  if (entry.status === "reverted") {
    return `Starknet reverted "${entry.summary}" after confirming it. Check its activity details before retrying.`;
  }
  if (entry.status === "rejected") {
    return `Starknet dropped "${entry.summary}" after confirming it. The transaction did not happen.`;
  }
  return `MC Wallet could not confirm "${entry.summary}". Check it on an explorer before retrying.`;
};
