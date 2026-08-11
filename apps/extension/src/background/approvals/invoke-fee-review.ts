/**
 * The reviewed half of a dapp invoke: which account an origin's grant currently
 * maps to, and what fee that account would pay for the calls it is being asked
 * to sign.
 *
 * Split out of `./provider-ops` because it answers a different question from
 * message dispatch, and because both the request handler and the held-approval
 * executor need the same answer. The fee produced here is not decoration: it is
 * shown on the approval card and then carried into submission as the ceiling the
 * transaction may sign under (MCW-V09-119), so "what the card said" and "what
 * gets enforced" are the same value from one place.
 *
 * Nothing here signs or broadcasts. Estimation runs with account validation
 * skipped, so a review can never open a Ledger prompt before the user approves,
 * and every failure degrades to a retryable state rather than a guess.
 */
import type { Call } from "starknet";
import { resolveFeeAffordability } from "@mc-wallet/transactions/fee-funds";
import { STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import type { StarkHashSigner } from "@mc-wallet/starknet/provider";
import type { FeeEstimate } from "@mc-wallet/starknet/rpc";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { InvokeFeeReview } from "./approvals";
import { readStrkBalance } from "../transactions/fee-guard";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";
import { resolveReviewFee } from "../accounts/wallet-ops";

/**
 * Dependencies needed to estimate the fee for a queued dapp invoke.
 */
export type InvokeFeeReviewDeps = {
  readonly runtimeRpc: RuntimeRpc;
};

/**
 * What a fee is being estimated FOR: the account that would pay it, the calls
 * it would pay for, the preferences that decide which endpoints to ask, and a
 * ready signer.
 *
 * The signer arrives already built rather than as the vault credential it was
 * built from. That is deliberate: estimating a fee is not an operation that
 * needs vault access, and a module that is never handed a credential cannot
 * leak, log, or widen the reach of one — which is also why this file stays
 * outside the secret-material boundary list in `scripts/check-file-standards`.
 */
export type InvokeFeeReviewTarget = {
  readonly account: AccountRef;
  readonly calls: readonly Call[];
  readonly preferences: WalletPreferences;
  /**
   * Builds the signer, on demand. A thunk and not a value for two reasons:
   * building one can throw (a keyless Ledger account with no panel queue
   * wired), and that is an estimate failure the card can offer a retry for, not
   * a crash in the message handler; and an undeployed account never estimates
   * at all, so it must never pay for a signer it will not use.
   */
  readonly signer: () => StarkHashSigner;
};

/**
 * The queued state of a fee that has been requested but not yet answered. The
 * approval button stays disabled while this is what the card is showing.
 */
export const PENDING_INVOKE_FEE: InvokeFeeReview = {
  fee: null,
  feeAffordability: "unknown",
  feeEstimateFailed: false,
  feeEstimatePending: true,
  requiresDeployment: false,
};

/**
 * The state of a fee the wallet could not obtain. Distinct from pending so the
 * card can offer a retry instead of a dead "unavailable" string — and distinct
 * from a real estimate, so nothing downstream mistakes it for a reviewed
 * ceiling.
 */
export const FAILED_INVOKE_FEE: InvokeFeeReview = {
  fee: null,
  feeAffordability: "unknown",
  feeEstimateFailed: true,
  feeEstimatePending: false,
  requiresDeployment: false,
};

/**
 * Estimates the fee for a queued dapp invoke, mirroring the Send review's shape
 * (deployment status → estimate → `resolveReviewFee`) so both journeys classify
 * fee outcomes identically. Nothing is broadcast or signed because the RPC
 * estimate skips account validation. Any failure — transport, RPC, or signer
 * construction — degrades to a retryable "estimate failed" state rather than
 * throwing, so a queued approval never dies of a fee it could not price.
 */
export const estimateInvokeApprovalFee = async (
  deps: InvokeFeeReviewDeps,
  review: InvokeFeeReviewTarget,
): Promise<InvokeFeeReview> => {
  const { account, calls, preferences } = review;
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences);
  // An unreadable deployment status must not block the review, so it fails open
  // to "deployed": the estimate is then attempted and its own failure is what
  // degrades the card, rather than a transport error silently reporting the
  // account as undeployed and demanding a deployment the user does not need.
  const deployed = await deps.runtimeRpc
    .getDeploymentStatus({ accountAddress: account.address, rpcUrls })
    .catch(() => true);
  let estimated: FeeEstimate | null = null;
  if (deployed) {
    try {
      estimated = await deps.runtimeRpc.estimateInvokeFee({
        account,
        calls: [...calls],
        rpcUrls,
        signHash: review.signer(),
      });
    } catch {
      estimated = null;
    }
  }
  const { fee, feeEstimateFailed } = resolveReviewFee({ deployed, fee: estimated });
  // Fee-affordability guard (issue 191): compare the estimate against the
  // account's STRK balance via the shared predicate. Warn-only and fail-open —
  // an unreadable balance yields "unknown" and never blocks the approval.
  const feeAffordability = resolveFeeAffordability({
    balance: fee === null ? null : await readStrkBalance(deps, account, preferences),
    fee,
  });
  return {
    fee,
    feeAffordability,
    feeEstimateFailed,
    feeEstimatePending: false,
    requiresDeployment: !deployed,
  };
};
