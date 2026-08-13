/**
 * Starknet declare-transaction submission backed by starknet-js and Krusty
 * signatures. Kept out of rpc.ts so that file stays within the size budget.
 */

import { WalletError } from "@mc-wallet/core/errors";
import { ensureAccountDeployed } from "@mc-wallet/starknet/deployment";
import {
  acceptedRpcWriteHash,
  krustyAccount,
  type StarkHashSigner,
  withRpcFallback,
  withRpcWrite,
} from "@mc-wallet/starknet/provider";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import type { Account, CompiledContract, RpcProvider } from "starknet";
import {
  authorizedSpendFor,
  exceedsReviewedFee,
  type FeeEstimate,
  reviewedSpendFor,
} from "../rpc/fee-bounds";

/**
 * Inputs for submitting one declare transaction. `contractClass` is the opaque
 * dapp-provided CONTRACT_CLASS; `classHash` is an optional optimization.
 */
export type DeclareInput = {
  readonly account: AccountRef;
  readonly classHash?: string;
  readonly compiledClassHash: string;
  readonly contractClass: unknown;
  /**
   * The declaration fee the approval card displayed. Supplying it makes that
   * figure a signing ceiling — see {@link submitDeclareTransaction}. Absent on
   * the estimate path and wherever no fee was reviewed.
   */
  readonly reviewedFee?: FeeEstimate;
  /**
   * The account-deployment fee the same approval card displayed, for a
   * declaration from an account that is not deployed yet. The card presents it
   * as part of an "Estimated total", so it is bound the same way the
   * declaration fee is — see {@link ensureAccountDeployed}. Absent when the
   * account is already deployed or no deployment fee could be estimated.
   */
  readonly reviewedDeploymentFee?: FeeEstimate;
  readonly rpcUrls: readonly string[];
  readonly signHash: StarkHashSigner;
};

/**
 * Declare submission result carrying the padded-source transaction and class
 * hashes returned by the node.
 */
export type DeclareSubmission = {
  readonly classHash: string;
  readonly transactionHash: string;
};

/**
 * Network fee estimate for a declaration, denominated by the RPC-provided unit.
 * The same shape as every other fee the wallet shows, so it is the same type:
 * one definition in `./fee-bounds`, kept re-exported under this name because
 * that is what the declare surface and its callers already say.
 */
export type DeclareFeeEstimate = FeeEstimate;

const declarePayload = ({
  classHash,
  compiledClassHash,
  contractClass,
}: Pick<DeclareInput, "classHash" | "compiledClassHash" | "contractClass">) => ({
  compiledClassHash,
  contract: contractClass as CompiledContract,
  ...(classHash === undefined ? {} : { classHash }),
});

/**
 * Estimates a Cairo 1 declaration fee without broadcasting or signing. The
 * estimate explicitly skips account validation, so the Krusty signer remains
 * untouched until the user approves the queued declaration.
 */
export const estimateDeclareFee = async (
  input: DeclareInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
  makeAccount: typeof krustyAccount = krustyAccount,
): Promise<DeclareFeeEstimate> =>
  withRpcFallback(
    input.rpcUrls,
    async (provider) => {
      const estimate = await makeAccount(
        provider,
        input.account,
        input.signHash,
      ).estimateDeclareFee(declarePayload(input), { skipValidate: true });
      return reviewedSpendFor(estimate, "standard");
    },
    makeProvider,
  );

// Settles the resource bounds a declaration will sign under. With no reviewed
// fee this is `{}` — starknet.js estimates internally, the pre-existing
// behaviour. With one, the estimate is taken here, the spend its bounds would
// authorise is compared against the figure the approval card showed, and those
// same bounds are then PASSED to `declare`, so what is signed is what was
// checked rather than a second quote the library takes moments later.
const checkedDeclareBounds = async (
  starknetAccount: Account,
  payload: ReturnType<typeof declarePayload>,
  reviewedFee: FeeEstimate | undefined,
): Promise<Record<string, unknown>> => {
  if (!reviewedFee) {
    return {};
  }
  const estimate = await starknetAccount.estimateDeclareFee(payload);
  const authorized = authorizedSpendFor(estimate, "standard");
  if (!authorized || exceedsReviewedFee(reviewedFee, authorized)) {
    throw new WalletError(
      "The network fee for this declaration rose above the amount you reviewed. Nothing was submitted — review it again.",
    );
  }
  return { resourceBounds: estimate.resourceBounds };
};

/**
 * Signs and submits a declare transaction through an account contract,
 * deploying the counterfactual account first when this is its first
 * transaction. Returns the node's transaction and class hashes. Optional
 * factories are dependency seams for deterministic tests; production uses the
 * standard RPC provider and Krusty account.
 *
 * With `reviewedFee`, the figure the user approved is a ceiling: a declaration
 * whose bounds would authorise more than that figure plus its headroom is
 * refused before anything is signed or broadcast, and the bounds signed are the
 * bounds that were checked. `reviewedDeploymentFee` binds the counterfactual
 * account deployment this may submit first in exactly the same way, so both
 * halves of the total the card showed are enforced rather than only the one the
 * user asked for.
 */
export const submitDeclareTransaction = async (
  {
    account,
    classHash,
    compiledClassHash,
    contractClass,
    reviewedDeploymentFee,
    reviewedFee,
    rpcUrls,
    signHash,
  }: DeclareInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
  makeAccount: typeof krustyAccount = krustyAccount,
): Promise<DeclareSubmission> =>
  withRpcWrite(
    rpcUrls,
    STARKNET_NETWORKS[account.networkId].chainId,
    async (provider) => {
      const starknetAccount = makeAccount(provider, account, signHash);
      await ensureAccountDeployed(provider, starknetAccount, account, reviewedDeploymentFee);
      const payload = declarePayload({
        compiledClassHash,
        contractClass,
        ...(classHash === undefined ? {} : { classHash }),
      });
      const bounds = await checkedDeclareBounds(starknetAccount as Account, payload, reviewedFee);
      const result = await (starknetAccount as Account).declare(
        payload,
        bounds as Parameters<Account["declare"]>[1],
      );
      return {
        classHash: acceptedRpcWriteHash(result.class_hash),
        transactionHash: acceptedRpcWriteHash(result.transaction_hash),
      };
    },
    makeProvider,
  );
