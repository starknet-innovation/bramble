/**
 * Approve path for an invoke whose card the user chose to pay in a token
 * other than STRK. It does not fall back to paying in STRK.
 */

import { executeInvokeApproval } from "../provider/provider-ops";
import { type ApplyResult, type ApproveDecision, reject, settleExecutor } from "./approval-applier";
import type { ApprovalDecisionDeps } from "./approval-decision-deps";
import type { ApprovalClaim, PendingApproval } from "./approvals";

/**
 * Submits the held invoke on the gasless lane. A missing price service or
 * choice is a refusal before anything is signed.
 */
export const applyGaslessInvoke = async (
  deps: ApprovalDecisionDeps,
  approval: PendingApproval,
  payload: NonNullable<ApprovalClaim["payload"]>,
  decision: ApproveDecision,
): Promise<ApplyResult> => {
  const prices = deps.prices;
  const chosen = decision.gaslessFee;
  if (!prices || !chosen) {
    return reject({ error: "Paying the network fee in another token is unavailable." });
  }
  const result = await executeInvokeApproval(
    {
      activity: deps.activity,
      allowanceStore: deps.allowanceStore,
      ...(deps.ledgerSignQueue ? { ledgerSignQueue: deps.ledgerSignQueue } : {}),
      ...(deps.multisigStore ? { multisigStore: deps.multisigStore } : {}),
      preferencesStore: deps.preferencesStore,
      prices,
      runtimeRpc: deps.runtimeRpc,
      session: deps.session,
      wallet: deps.wallet,
    },
    {
      ...(approval.context === undefined ? {} : { context: approval.context }),
      gaslessFee: chosen,
      origin: approval.origin,
      payload,
      ...(approval.fee ? { reviewedFee: approval.fee } : {}),
    },
  );
  return settleExecutor(result);
};
