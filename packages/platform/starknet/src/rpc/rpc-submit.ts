/**
 * Non-retriable Starknet invoke submission through a Krusty-backed account.
 */

import { WalletError } from "@mc-wallet/core/errors";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import type { Strk20Proof } from "@mc-wallet/wallet-protocol/strk20";
import type { Account, Call, RpcProvider } from "starknet";
import { ensureAccountDeployed, isCompatibleAccountDeployed } from "../transactions/deployment";
import {
  authorizedSpendFor,
  exceedsReviewedFee,
  type FeeEstimate,
  type FeeSpeed,
  scaleFeeBounds,
} from "./fee-bounds";
import { estimateExactInvokeFee } from "./invoke-fee";
import {
  argentQueryAccount,
  krustyAccount,
  matchingAcceptedRpcWriteHash,
  type StarkHashSigner,
  withRpcWrite,
} from "./provider";

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
  /** Live authorization checked immediately before each on-chain mutation. */
  readonly isAuthorized?: () => boolean;
  /** Optional STRK20 proof material attached to a prepared privacy call. */
  readonly proof?: Strk20Proof;
  /**
   * The fee estimate this submission was reviewed against — the exact figure a
   * user was shown before consenting, which for a `fast` review is the figure
   * that lane's scaled bounds imply and not the node's headline quote.
   * This is mandatory and turns that figure into a ceiling:
   * {@link submitInvokeTransaction} re-estimates, refuses when the spend the
   * bounds it is about to sign would authorise has outrun
   * {@link REVIEWED_FEE_HEADROOM}, and then signs exactly those bounds.
   *
   * If absent, the submit boundary fails closed before touching the network.
   */
  readonly reviewedFee?: FeeEstimate;
  /** Separately reviewed ceiling for an automatic account deployment. */
  readonly reviewedDeploymentFee?: FeeEstimate;
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

/**
 * Refusal shared by invoke callers missing an exact user-reviewed fee ceiling;
 * the submit boundary throws this before signing or broadcasting.
 */
export const REVIEWED_FEE_REQUIRED =
  "The network fee was not reviewed. Nothing was submitted — review the transaction again.";

// Settles the resource bounds this submission will sign. A reviewed fee is
// mandatory. The estimate is taken HERE and the
// bounds are passed explicitly even at standard speed. That is the point of the
// exercise: a ceiling checked against one estimate while starknet.js quietly
// signs bounds from a second one it took itself would bind nothing. One
// estimate, scaled for the chosen speed, checked in the scaled form, and then
// signed — checking before the scaling would compare a figure this lane has
// already decided not to sign.
const settledResourceBounds = async (
  estimatingAccount: Account,
  account: AccountRef,
  calls: readonly Call[],
  proof: Strk20Proof | undefined,
  deployed: boolean,
  speed: FeeSpeed,
  reviewedFee: FeeEstimate | undefined,
  skipValidate: boolean,
): Promise<unknown> => {
  if (!reviewedFee) {
    throw new WalletError(REVIEWED_FEE_REQUIRED);
  }
  const estimate = await estimateExactInvokeFee(
    estimatingAccount,
    account,
    calls,
    proof,
    deployed,
    skipValidate,
  );
  const authorized = authorizedSpendFor(estimate, speed);
  if (!authorized || exceedsReviewedFee(reviewedFee, authorized)) {
    throw new WalletError(REVIEWED_FEE_EXCEEDED);
  }
  return speed === "fast" ? scaleFeeBounds(estimate.resourceBounds) : estimate.resourceBounds;
};

const invokeEstimatingAccount = (
  provider: RpcProvider,
  account: AccountRef,
  submittingAccount: Account,
): { readonly account: Account; readonly skipValidate: boolean } =>
  account.accountContractType === "argent"
    ? { account: argentQueryAccount(provider, account), skipValidate: false }
    : { account: submittingAccount, skipValidate: true };

const assertAuthorized = (isAuthorized: (() => boolean) | undefined): void => {
  if (isAuthorized?.() === false) {
    throw new WalletError("wallet locked");
  }
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
 * A missing reviewed fee is refused before endpoint selection. If automatic
 * deployment is needed, invoke bounds are settled first against an ordered
 * deploy-then-invoke simulation, so no fee refusal can occur after deployment.
 * Any later failure reports the accepted deployment hash rather than hiding a
 * durable side effect behind a generic transfer failure.
 */
export const submitInvokeTransaction = async (
  {
    account,
    calls,
    isAuthorized,
    proof,
    reviewedDeploymentFee,
    reviewedFee,
    rpcUrls,
    signHash,
    speed = "standard",
  }: InvokeInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<InvokeSubmission> => {
  if (calls.length === 0) {
    throw new WalletError("No calls to submit");
  }
  if (!reviewedFee) {
    throw new WalletError(REVIEWED_FEE_REQUIRED);
  }
  return withRpcWrite(
    rpcUrls,
    STARKNET_NETWORKS[account.networkId].chainId,
    async (provider) => {
      const capturedTransactionHashes: string[] = [];
      const starknetAccount = krustyAccount(provider, account, async (messageHash) => {
        const approvalProof = await signHash(messageHash);
        capturedTransactionHashes.push(messageHash);
        return approvalProof;
      });
      const estimating = invokeEstimatingAccount(provider, account, starknetAccount);
      const deployed = await isCompatibleAccountDeployed(provider, account);
      const resourceBounds = await settledResourceBounds(
        estimating.account,
        account,
        calls,
        proof,
        deployed,
        speed,
        reviewedFee,
        estimating.skipValidate,
      );
      const deployment = deployed
        ? null
        : await ensureAccountDeployed(
            provider,
            starknetAccount,
            account,
            reviewedDeploymentFee,
            () => capturedTransactionHashes[0],
            isAuthorized,
          );
      const invokeHashIndex = capturedTransactionHashes.length;
      const details = {
        ...(resourceBounds === null ? {} : { resourceBounds }),
        ...(proof ? { proof: proof.data, proofFacts: [...proof.proof_facts] } : {}),
        tip: "0x0",
      };
      try {
        assertAuthorized(isAuthorized);
        const result = await starknetAccount.execute(
          [...calls],
          details as Parameters<Account["execute"]>[1],
        );
        return {
          calls,
          transactionHash: matchingAcceptedRpcWriteHash(
            result.transaction_hash,
            capturedTransactionHashes[invokeHashIndex],
          ),
        };
      } catch (error) {
        if (deployment) {
          throw new WalletError(
            `Account deployment ${deployment.transactionHash} completed, but the following transaction could not be confirmed. Check on-chain state before retrying.`,
          );
        }
        throw error;
      }
    },
    makeProvider,
  );
};
