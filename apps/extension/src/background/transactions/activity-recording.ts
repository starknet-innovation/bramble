/** Best-effort activity journaling after a transaction has been broadcast. */

import type { ActivityLog } from "@mc-wallet/transactions/activity";

type SubmittedActivity = Parameters<ActivityLog["record"]>[0];

/**
 * Records an accepted broadcast without allowing local storage failure to
 * rewrite the chain outcome returned to the caller. Reconciliation may recover
 * a missed entry from chain history; the accepted hash remains authoritative.
 */
export const recordSubmittedActivity = async (
  activity: ActivityLog,
  entry: SubmittedActivity,
): Promise<void> => {
  try {
    await activity.record(entry);
  } catch {
    // The transaction is already on its way. Its accepted hash must survive.
  }
};
