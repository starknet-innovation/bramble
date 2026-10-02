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
 * Records a locally signed SNIP-9 OutsideExecution without letting a storage
 * failure rewrite the response the caller already produced. The signed result
 * remains authoritative; a missed journal row is recoverable from chain
 * history on a later scan.
 */
export const recordRelaySignature = async (
  activity: Pick<ActivityLog, "recordRelaySignature">,
  entry: Parameters<NonNullable<ActivityLog["recordRelaySignature"]>>[0],
): Promise<void> => {
  try {
    await activity.recordRelaySignature?.(entry);
  } catch {
    // The signed result is already computed. Its delivery must survive.
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
