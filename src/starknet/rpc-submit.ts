/**
 * Non-retriable Starknet invoke submission through a Krusty-backed account.
 */
import type { Account, Call, RpcProvider } from "starknet";
import { WalletError } from "../shared/errors";
import type { AccountRef } from "../storage/vault-schema";
import { ensureAccountDeployed } from "./deployment";
import {
  authorizedSpendFor,
  exceedsReviewedFee,
  type FeeEstimate,
  type FeeSpeed,
  scaleFeeBounds,
} from "./fee-bounds";
import { STARKNET_NETWORKS } from "./networks";
import { krustyAccount, type StarkHashSigner, withRpcWrite } from "./provider";
import type { Strk20Proof } from "./strk20/schemas";

/**
 * Fee speed control: standard signs the bounds the node's estimate implies,
 * fast scales them up for faster inclusion. Defined in `./fee-bounds`, where
 * the scale itself lives, and re-exported here because this is the surface
 * callers already import their submission types from.
 */
export type { FeeSpeed };

/**
 * Inputs for submitting one or more invoke calls.
 */
export type InvokeInput = {
  readonly account: AccountRef;
  readonly calls: readonly Call[];
  /** Optional STRK20 proof material attached to a prepared privacy call. */
  readonly proof?: Strk20Proof;
  /**
   * The fee estimate this submission was reviewed against — the exact figure a
   * user was shown before consenting, which for a `fast` review is the figure
   * that lane's scaled bounds imply and not the node's headline quote.
   * Supplying it turns that figure into a ceiling:
   * {@link submitInvokeTransaction} re-estimates, refuses when the spend the
   * bounds it is about to sign would authorise has outrun
   * {@link REVIEWED_FEE_HEADROOM}, and then signs exactly those bounds.
   *
   * Absent means no user reviewed a fee for these calls (an estimate that
   * failed, or an internal submission with no review step), and the submission
   * is bounded only by the node's own quote — the pre-existing behaviour, and
   * why this is optional rather than defaulted to something invented.
   */
  readonly reviewedFee?: FeeEstimate;
  readonly rpcUrls: readonly string[];
  readonly signHash: StarkHashSigner;
  readonly speed?: FeeSpeed;
};

/**
 * Generic invoke submission result.
 */
export type InvokeSubmission = {
  readonly calls: readonly Call[];
  readonly transactionHash: string;
};

/**
 * Refusal shown when a submission would sign for more than the user reviewed.
 * Exported so the surfaces that present it, and the tests that pin it, name the
 * same string rather than three approximations of it.
 */
export const REVIEWED_FEE_EXCEEDED =
  "The network fee for this transaction rose above the amount you reviewed. Nothing was submitted — review it again.";

// Settles the resource bounds this submission will sign. Null means "let
// starknet.js estimate once internally", the behavior of a standard-speed send
// with nothing to hold it to.
//
// When the caller carries a reviewed fee, the estimate is taken HERE and the
// bounds are passed explicitly even at standard speed. That is the point of the
// exercise: a ceiling checked against one estimate while starknet.js quietly
// signs bounds from a second one it took itself would bind nothing. One
// estimate, scaled for the chosen speed, checked in the scaled form, and then
// signed — checking before the scaling would compare a figure this lane has
// already decided not to sign.
const settledResourceBounds = async (
  starknetAccount: Account,
  calls: readonly Call[],
  speed: FeeSpeed,
  reviewedFee: FeeEstimate | undefined,
): Promise<unknown> => {
  if (speed !== "fast" && !reviewedFee) {
    return null;
  }
  const estimate = await starknetAccount.estimateInvokeFee([...calls]);
  if (reviewedFee) {
    const authorized = authorizedSpendFor(estimate, speed);
    if (!authorized || exceedsReviewedFee(reviewedFee, authorized)) {
      throw new WalletError(REVIEWED_FEE_EXCEEDED);
    }
  }
  return speed === "fast" ? scaleFeeBounds(estimate.resourceBounds) : estimate.resourceBounds;
};

/**
 * Signs and submits generic Starknet invoke calls exactly once after selecting
 * a chain-matching RPC endpoint. Once submission starts, transport ambiguity
 * is returned to the caller and never replayed against a fallback endpoint.
 *
 * With `reviewedFee`, the figure the user consented to is a ceiling. The
 * submission-time estimate is turned into the bounds this speed would sign, the
 * spend those bounds authorise is compared against the reviewed figure, and the
 * send is refused — before anything is signed or broadcast — when it has risen
 * past {@link REVIEWED_FEE_HEADROOM} or when the bounds cannot be read well
 * enough to state what they authorise. The bounds then signed are the exact
 * bounds that were checked, on both the standard and the `fast` lane, so the
 * ceiling holds over the transaction that actually goes out and the signed
 * authority never exceeds the reviewed figure by more than the headroom.
 *
 * Without it the submission is bounded only by the node's own quote, so a
 * caller that showed the user a fee and did not pass it back gets no
 * enforcement.
 */
export const submitInvokeTransaction = async (
  { account, calls, proof, reviewedFee, rpcUrls, signHash, speed = "standard" }: InvokeInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<InvokeSubmission> => {
  if (calls.length === 0) {
    throw new WalletError("No calls to submit");
  }
  return withRpcWrite(
    rpcUrls,
    STARKNET_NETWORKS[account.networkId].chainId,
    async (provider) => {
      const starknetAccount = krustyAccount(provider, account, signHash);
      await ensureAccountDeployed(provider, starknetAccount, account);
      const resourceBounds = await settledResourceBounds(
        starknetAccount,
        calls,
        speed,
        reviewedFee,
      );
      const details = {
        ...(resourceBounds === null ? {} : { resourceBounds }),
        ...(proof ? { proof: proof.data, proofFacts: [...proof.proof_facts] } : {}),
      };
      const result = await starknetAccount.execute(
        [...calls],
        details as Parameters<Account["execute"]>[1],
      );
      return {
        calls,
        transactionHash: result.transaction_hash,
      };
    },
    makeProvider,
  );
};
