/** Best-effort activity journaling after a transaction has been broadcast. */

import type { ActivityLog } from "@bramble/transactions/activity";
import { recipientForFlags } from "@bramble/transactions/verify-decode";
import { canonicalFelt, isNonZeroStarkFieldElement } from "@bramble/wallet-model/networks";
import type { Call } from "starknet";

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

/**
 * Runs the bookkeeping that follows a broadcast — allowance rows, the activity
 * line, and the values they are built from — so that nothing in it can replace
 * the reply. Once a transaction hash exists the caller must answer with that
 * hash (success, or status unknown), never a plain error the panel would read
 * as "not sent" (errors audit F1/F2). A failure here leaves a local row
 * missing, which reconciliation recovers from chain history; it says nothing
 * about the transaction, so it is absorbed rather than reported as one.
 */
export const afterBroadcast = async (bookkeeping: () => Promise<void>): Promise<void> => {
  try {
    await bookkeeping();
  } catch {
    // The transaction is on its way; only a local record is missing.
  }
};

/**
 * The `counterparty` to record for a wallet-submitted call set that pays one
 * recipient, so the payee joins the paid-recipient trust set (audit #163).
 * Only a single call whose selector has a known recipient position counts: a
 * multicall has no one payee, and an unknown selector names none. Returns an
 * empty object otherwise, so callers spread it into the recorded row.
 */
export const paidCounterparty = (calls: readonly Call[]): { readonly counterparty?: string } => {
  const [call, ...rest] = calls;
  if (call === undefined || rest.length > 0 || !Array.isArray(call.calldata)) {
    return {};
  }
  const recipient = canonicalFelt(recipientForFlags(call, call.calldata));
  return recipient !== null && isNonZeroStarkFieldElement(recipient)
    ? { counterparty: recipient }
    : {};
};
