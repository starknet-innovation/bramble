/**
 * Shared shapes for the approve-decision appliers in `approval-decisions.ts`:
 * what an applier returns, what the deciding surface reported, and the two
 * result helpers every applier ends with. The applier type stays with the
 * dispatcher, which owns its dependencies. Kept apart so the dispatcher stays
 * within the file cap; nothing here touches the queue or a dapp waiter.
 */

import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { GaslessFeeOffer } from "@bramble/transactions/gasless-request";
import type { DeferredStrk20Approval } from "../privacy/strk20-approval-staging";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { PendingApproval } from "./approvals";

/**
 * Outcome of applying an already-claimed approve decision.
 */
export type ApplyResult =
  | DeferredStrk20Approval
  | { readonly status: "reject"; readonly response: RuntimeResponse }
  | {
      readonly status: "settle";
      readonly settle: RuntimeResponse;
      readonly respond: (listPending: () => readonly PendingApproval[]) => RuntimeResponse;
    };

/**
 * What the deciding surface reported about its own render, alongside the id it
 * decided. Only the fee travels today; it is separate from the claimed approval
 * because it describes the CARD, not the queue entry.
 */
export type ApproveDecision = {
  /** Set when the user chose a token other than STRK for the network fee. */
  readonly gaslessFee?: GaslessFeeOffer;
  readonly reviewedAccountId?: string;
  readonly reviewedFee?: FeeEstimate;
};

/** A decision refused before anything settled; the response goes back as is. */
export const reject = (response: RuntimeResponse): ApplyResult => ({ response, status: "reject" });

/**
 * Shared tail for executor-backed kinds: settle the executor result either way,
 * pass its error through on failure, and surface `{ ok, pending }` on success.
 */
export const settleExecutor = (result: RuntimeResponse): ApplyResult => ({
  respond: (listPending) => ("error" in result ? result : { ok: true, pending: listPending() }),
  settle: result,
  status: "settle",
});
