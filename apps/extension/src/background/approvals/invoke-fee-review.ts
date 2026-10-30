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

import type { PriceService } from "@bramble/portfolio/prices";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { UndeployedBraavosError } from "@bramble/starknet/deployment";
import type { StarkHashSigner } from "@bramble/starknet/provider";
import type { FeeEstimate } from "@bramble/starknet/rpc";
import { resolveFeeAffordability } from "@bramble/transactions/fee-funds";
import { gaslessStrkAffordability } from "@bramble/transactions/gasless-request";
import { isDeployableBraavos } from "@bramble/wallet-model/account-families";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { Strk20Proof } from "@bramble/wallet-protocol/strk20";
import type { Call } from "starknet";
import { resolveReviewFee } from "../accounts/wallet-ops";
import { isPoolShapedBatch } from "../privacy/strk20-account-context";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";
import { readStrkBalance } from "../transactions/fee-guard";
import { reviewGaslessOffers } from "../transactions/gasless-review";
import type { InvokeFeeReview } from "./approvals";

/**
 * Dependencies needed to estimate the fee for a queued dapp invoke.
 */
export type InvokeFeeReviewDeps = {
  readonly prices?: PriceService;
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
  readonly proof?: Strk20Proof;
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
 * The review of an invoke from an undeployed Braavos account: it deploys only
 * through its own reviewed step, so the card says so instead of offering a fee
 * or a retry, and Approve stays disabled (there is no fee to bind).
 */
const DEPLOY_FIRST_INVOKE_FEE: InvokeFeeReview = {
  deployFirst: true,
  fee: null,
  feeAffordability: "unknown",
  feeEstimateFailed: false,
  feeEstimatePending: false,
  requiresDeployment: true,
};

const gaslessOffersFor = async (
  deps: InvokeFeeReviewDeps,
  input: {
    readonly account: InvokeFeeReviewTarget["account"];
    readonly calls: InvokeFeeReviewTarget["calls"];
    readonly fee: InvokeFeeReview["fee"];
    readonly feeAffordability: InvokeFeeReview["feeAffordability"];
    readonly preferences: InvokeFeeReviewTarget["preferences"];
    readonly proof?: InvokeFeeReviewTarget["proof"];
  },
): Promise<NonNullable<InvokeFeeReview["gaslessFees"]>> => {
  const prices = deps.prices;
  // A proof is not representable on the gasless relay. Pool batches are the
  // same refusal: they belong on the STRK20 lane.
  if (
    prices === undefined ||
    input.proof !== undefined ||
    isPoolShapedBatch(input.calls, input.preferences, input.account.networkId)
  ) {
    return [];
  }
  return reviewGaslessOffers({
    account: input.account,
    calls: [...input.calls],
    preferences: input.preferences,
    prices,
    runtimeRpc: deps.runtimeRpc,
    strkAffordability: input.feeAffordability,
    strkFee: input.fee,
  }).catch(() => []);
};

const reviewedGaslessFees = async (
  deps: InvokeFeeReviewDeps,
  review: InvokeFeeReviewTarget,
  balance: string | null,
  fee: FeeEstimate | null,
): Promise<{ readonly gaslessFees: NonNullable<InvokeFeeReview["gaslessFees"]> } | undefined> => {
  const gaslessFees = await gaslessOffersFor(deps, {
    account: review.account,
    calls: review.calls,
    fee,
    feeAffordability: gaslessStrkAffordability(review.calls, balance, fee),
    preferences: review.preferences,
    ...(review.proof ? { proof: review.proof } : {}),
  });
  return gaslessFees.length > 0 ? { gaslessFees } : undefined;
};

/**
 * Estimates the fee for a queued dapp invoke, mirroring the Send review's shape
 * (deployment status → estimate → `resolveReviewFee`) so both journeys classify
 * fee outcomes identically. Nothing is broadcast or signed because the RPC
 * estimate skips account validation. Any failure — transport, RPC, or signer
 * construction — degrades to a retryable "estimate failed" state rather than
 * throwing, so a queued approval never dies of a fee it could not price. The
 * one exception is an undeployed Braavos account, answered with a deploy-first
 * review — by account state, or by the platform's typed refusal.
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
  if (!deployed && isDeployableBraavos(account)) return DEPLOY_FIRST_INVOKE_FEE;
  let estimated: FeeEstimate | null = null;
  if (deployed) {
    try {
      estimated = await deps.runtimeRpc.estimateInvokeFee({
        account,
        calls: [...calls],
        ...(review.proof ? { proof: review.proof } : {}),
        rpcUrls,
        signHash: review.signer(),
      });
    } catch (error) {
      if (error instanceof UndeployedBraavosError) return DEPLOY_FIRST_INVOKE_FEE;
      estimated = null;
    }
  }
  const { fee, feeEstimateFailed } = resolveReviewFee({ deployed, fee: estimated });
  // Fee-affordability guard (issue 191): compare the estimate against the
  // account's STRK balance via the shared predicate. Warn-only and fail-open —
  // an unreadable balance yields "unknown" and never blocks the approval.
  const balance = fee === null ? null : await readStrkBalance(deps, account, preferences);
  const feeAffordability = resolveFeeAffordability({ balance, fee });
  // STRK the calls spend counts toward the shortfall the offer uses. The card's
  // own verdict stays fee-only. Proofs and pool batches are omitted inside the helper.
  const gasless = await reviewedGaslessFees(deps, review, balance, fee);
  return {
    fee,
    feeAffordability,
    feeEstimateFailed,
    feeEstimatePending: false,
    ...gasless,
    requiresDeployment: !deployed,
  };
};
