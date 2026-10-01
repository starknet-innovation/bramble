/** Best-effort activity journaling after a transaction has been broadcast. */

import type { ActivityLog } from "@bramble/transactions/activity";

type SubmittedActivity = Omit<Parameters<ActivityLog["record"]>[0], "origin">;

/**
 * Records an accepted broadcast without allowing local storage failure to
 * rewrite the chain outcome returned to the caller. Reconciliation may recover
 * a missed entry from chain history; the accepted hash remains authoritative.
 *
 * This is the only writer of `origin: "wallet"` (audit #163): the marker says
 * this wallet broadcast the transaction, which is what lets a transfer's
 * counterparty count as a recipient the user paid. Callers cannot set it.
 */
export const recordSubmittedActivity = async (
  activity: ActivityLog,
  entry: SubmittedActivity,
): Promise<void> => {
  try {
    await activity.record({ ...entry, origin: "wallet" });
  } catch {
    // The transaction is already on its way. Its accepted hash must survive.
  }
};
