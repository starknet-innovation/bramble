/**
 * Execution of a dapp invoke the user has already approved.
 *
 * Split from ./provider-ops by trust step: the request handlers there decide
 * whether to QUEUE an approval, while everything here runs after consent and is
 * the last point at which a revoked grant, a switched network, or a locked
 * wallet must still fail closed. Nothing is broadcast before this boundary.
 */

import { errorDetail, walletErrorMessage } from "@mc-wallet/core/errors";
import type { LedgerStrk20Intents } from "@mc-wallet/ledger-protocol/intent";
import { mapStrk20StageError } from "@mc-wallet/privacy/official-sdk-errors";
import { unavailableStrk20Service } from "@mc-wallet/privacy/service";
import type { FeeEstimate } from "@mc-wallet/starknet/fee-bounds";
import {
  refuseOnAccountSelfCall,
  refuseOnPoisonedRecipient,
  verificationContext,
  verifyCalls,
} from "@mc-wallet/transactions/verify";
import { STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import type { ApprovalContext } from "../approvals/approval-context";
import type { ApprovalPayload } from "../approvals/approvals";
import { allowanceOwner, recordApproveAllowances } from "../portfolio/allowance-recording";
import { strk20AccountContext } from "../privacy/strk20-account-context";
import { networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import { recordSubmittedActivity } from "../transactions/activity-recording";
import { type InvokeExecuteDeps, resolveOriginAccount } from "./provider-ops";

const invokeFailureMessage = (error: unknown, hasProof: boolean): string => {
  if (!hasProof) {
    return walletErrorMessage(error, "invoke request failed");
  }
  try {
    mapStrk20StageError("submission", error);
  } catch (mapped) {
    return walletErrorMessage(mapped, "invoke request failed");
  }
  return "invoke request failed";
};

/**
 * Names the device prompts for one submitted invoke.
 *
 * Both slots name the same signature on purpose. The proof lane performs only
 * the submit half — the site collected the CallSet authorization when it prepared
 * the proof — and the plain lane authorizes the site's calls themselves; either
 * way this path takes exactly one signature, so both slots must describe that
 * one thing rather than leaving the other misdescribed.
 */
const submitIntents = (hasProof: boolean): LedgerStrk20Intents =>
  hasProof
    ? { authorize: "strk20-broadcast", submit: "strk20-broadcast" }
    : { authorize: "dapp-transaction", submit: "dapp-transaction" };

/**
 * Builds the refusal for a failed submission, carrying the node's own reason
 * only where it is safe to.
 *
 * Only a plain invoke may carry the raw reason. A proof-bearing failure is
 * sanitized by `mapStrk20StageError` precisely because the raw error can echo a
 * private request body, so that text must not reach any surface — the structured
 * reason it already produces is the whole story there. `detail` is a
 * wallet-internal diagnostic and never reaches the requesting page.
 */
const invokeFailureResponse = (error: unknown, hasProof: boolean): RuntimeResponse => {
  const message = invokeFailureMessage(error, hasProof);
  const detail = hasProof ? null : errorDetail(error, message);
  return detail === null ? { error: message } : { detail, error: message };
};

/**
 * Executes a user-approved invoke: re-resolves the currently active account for
 * the origin (a locked wallet or a revoked grant fails safely), submits the held
 * calls, and records the transaction and any approvals. Returns an error
 * response instead of throwing so the caller can keep the approval queued.
 *
 * `reviewedFee` is the estimate the approval card was showing when the user
 * approved. It travels into the submit boundary as a signing ceiling, so a
 * transaction whose cost has moved past it since the review is refused rather
 * than signed — the site that asked for the call also controls state the call's
 * gas can depend on, and can move it while the card is open.
 */
export const executeInvokeApproval = async (
  deps: InvokeExecuteDeps,
  approval: {
    readonly context?: ApprovalContext;
    readonly origin: string;
    readonly payload: ApprovalPayload;
    readonly reviewedFee?: FeeEstimate;
  },
): Promise<RuntimeResponse> => {
  const { activity, allowanceStore, runtimeRpc } = deps;
  const calls = approval.payload.calls;
  if (!calls) {
    return { error: "approval not found" };
  }
  const resolved = await resolveOriginAccount(deps, approval.origin, approval.context);
  if ("error" in resolved) {
    return resolved;
  }
  const { account, preferences } = resolved;
  const authorized = captureSessionAuthorization(deps.session);
  // The recipient policy is re-applied to the exact calls that are about to be
  // broadcast, not only to the ones that were queued: the address book can gain
  // a contact while the prompt sits open, and a payee that mimics it becomes a
  // lookalike only at that moment. Same shared gate as the queue-time check
  // above and as the post-consent check the STRK20 executor applies, so a
  // decision the user made against one trusted set is never carried out against
  // another. Refusal, not annotation — nothing is submitted.
  const refusal =
    refuseOnAccountSelfCall(calls, account.address) ??
    refuseOnPoisonedRecipient(verifyCalls(calls, verificationContext(account, preferences)));
  if (refusal) {
    return refusal;
  }
  // A keyless Ledger account signs on the device (verified against publicKeyX),
  // every other account through the vault — the same seam the wallet-initiated
  // paths use. A device rejection/timeout/verify-failure, or a Ledger account
  // with no queue wired, throws a WalletError from the sign path: catch it and
  // return `{ error }` (mirroring executeStrk20InvokeApproval) so the applier
  // settles the held request with the reason. Fails closed — nothing submitted.
  // Spread into whichever submit lane runs: the ceiling is a property of the
  // approval, not of the lane, so it is decided once here rather than at each.
  const ceiling = approval.reviewedFee ? { reviewedFee: approval.reviewedFee } : {};
  const strk20 = runtimeRpc.strk20 ?? unavailableStrk20Service;
  try {
    const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences);
    // One protected-account boundary for both lanes. The signing thunk and the
    // viewing-key thunk are built there, bound to the unlock that authorized
    // this approval, so a lock between the click and the broadcast revokes both
    // — a second local viewing-key reader here was the one copy that derived a
    // key for an already-locked wallet.
    const context = strk20AccountContext(
      deps,
      { ...resolved, rpcUrls },
      submitIntents(approval.payload.proof !== undefined),
    );
    const result = approval.payload.proof
      ? await strk20.submitPrepared({
          ...context,
          calls,
          proof: approval.payload.proof,
          ...ceiling,
        })
      : await runtimeRpc.submitInvokeTransaction({
          account,
          calls,
          ...ceiling,
          isAuthorized: authorized.isCurrent,
          rpcUrls,
          signHash: context.signHash,
        });
    // Recorded before the activity line: see ./allowance-recording.
    await recordApproveAllowances({
      assets: verificationContext(account, preferences),
      calls,
      owner: allowanceOwner(account),
      store: allowanceStore,
    });
    await recordSubmittedActivity(activity, {
      accountId: account.id,
      hash: result.transactionHash,
      kind: "invoke",
      networkId: account.networkId,
      summary: `${approval.origin} submitted ${calls.length} call${calls.length === 1 ? "" : "s"}`,
    });
    return { ok: true, transactionHash: result.transactionHash };
  } catch (error) {
    return invokeFailureResponse(error, approval.payload.proof !== undefined);
  }
};
