/**
 * Starknet declare-transaction submission backed by starknet-js and Krusty
 * signatures. Kept out of rpc.ts so that file stays within the size budget.
 */

import { WalletError } from "@mc-wallet/core/errors";
import {
  accountDeployment,
  type DeploySubmission,
  ensureAccountDeployed,
  isCompatibleAccountDeployed,
} from "@mc-wallet/starknet/deployment";
import {
  type AccountHashSigner,
  acceptedRpcWriteHash,
  argentQueryAccount,
  IndeterminateRpcWriteError,
  krustyAccount,
  matchingAcceptedRpcWriteHash,
  withRpcFallback,
  withRpcWrite,
} from "@mc-wallet/starknet/provider";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  STARKNET_NETWORKS,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";
import {
  type Account,
  type CompiledContract,
  hash,
  type RpcProvider,
  TransactionType,
} from "starknet";
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
  /** Live authorization checked immediately before each on-chain mutation. */
  readonly isAuthorized?: () => boolean;
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
  readonly signHash: AccountHashSigner;
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
}: Pick<DeclareInput, "classHash" | "compiledClassHash" | "contractClass">) => {
  let computed: string;
  try {
    computed = hash.computeContractClassHash(contractClass as CompiledContract);
  } catch {
    throw new WalletError("Invalid Starknet contract class");
  }
  const computedClassHash = canonicalFelt(computed);
  if (computedClassHash === null || !isNonZeroStarkFieldElement(computedClassHash)) {
    throw new WalletError("Invalid Starknet contract class hash");
  }
  if (classHash !== undefined && !sameFelt(classHash, computedClassHash)) {
    throw new WalletError("Supplied class hash does not match the Starknet contract class");
  }
  return {
    classHash: computedClassHash,
    compiledClassHash,
    contract: contractClass as CompiledContract,
  };
};

const acceptedDeclareSubmission = (
  result: { readonly class_hash: unknown; readonly transaction_hash: unknown },
  intendedClassHash: string,
  transactionHash: unknown,
): DeclareSubmission => {
  const classHash = acceptedRpcWriteHash(result.class_hash);
  if (!sameFelt(classHash, intendedClassHash)) {
    throw new IndeterminateRpcWriteError(
      "RPC accepted a different declared class hash. Check on-chain state before retrying.",
    );
  }
  return {
    classHash,
    transactionHash: matchingAcceptedRpcWriteHash(result.transaction_hash, transactionHash),
  };
};

const rethrowDeclareAfterDeployment = (
  error: unknown,
  deployment: DeploySubmission | null,
): never => {
  if (!deployment) {
    throw error;
  }
  const message = `Account deployment ${deployment.transactionHash} completed, but the following declaration could not be confirmed. Check on-chain state before retrying.`;
  if (error instanceof IndeterminateRpcWriteError) {
    throw new IndeterminateRpcWriteError(message);
  }
  throw new WalletError(message);
};

const estimateExactDeclareFee = async (
  estimatingAccount: Account,
  account: AccountRef,
  payload: ReturnType<typeof declarePayload>,
  deployed: boolean,
  skipValidate: boolean,
): ReturnType<Account["estimateDeclareFee"]> => {
  const details = { skipValidate, tip: "0x0" } as Parameters<Account["estimateDeclareFee"]>[1];
  if (deployed) {
    return estimatingAccount.estimateDeclareFee(payload, details);
  }
  const deployment = accountDeployment(account);
  const estimates = await estimatingAccount.estimateFeeBulk(
    [
      {
        type: TransactionType.DEPLOY_ACCOUNT,
        payload: {
          addressSalt: deployment.addressSalt,
          classHash: deployment.classHash,
          constructorCalldata: [...deployment.constructorCalldata],
          contractAddress: deployment.contractAddress,
        },
      },
      { type: TransactionType.DECLARE, payload },
    ],
    details,
  );
  const estimate = estimates[1];
  if (!estimate) {
    throw new WalletError("The node did not return a declaration fee estimate");
  }
  return estimate;
};

/**
 * Estimates a Cairo 1 declaration fee without broadcasting or private signing.
 * Argent includes validation through a public query signature; OZ skips it so
 * a Ledger review never prompts the device.
 */
export const estimateDeclareFee = async (
  input: DeclareInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
  makeAccount: typeof krustyAccount = krustyAccount,
): Promise<DeclareFeeEstimate> =>
  withRpcFallback(
    input.rpcUrls,
    async (provider) => {
      const validateArgent = input.account.accountContractType === "argent";
      const deployed = await isCompatibleAccountDeployed(provider, input.account);
      const estimatingAccount = validateArgent
        ? argentQueryAccount(provider, input.account)
        : makeAccount(provider, input.account, input.signHash);
      const estimate = await estimateExactDeclareFee(
        estimatingAccount,
        input.account,
        declarePayload(input),
        deployed,
        !validateArgent,
      );
      return reviewedSpendFor(estimate, "standard");
    },
    makeProvider,
  );

// Settles declaration bounds before an optional account deployment. An
// undeployed account is simulated as DEPLOY_ACCOUNT then DECLARE, so no fee
// refusal or estimation failure can occur only after deployment was broadcast.
const checkedDeclareBounds = async (
  estimatingAccount: Account,
  account: AccountRef,
  payload: ReturnType<typeof declarePayload>,
  deployed: boolean,
  reviewedFee: FeeEstimate | undefined,
  skipValidate: boolean,
): Promise<Record<string, unknown>> => {
  const estimate = await estimateExactDeclareFee(
    estimatingAccount,
    account,
    payload,
    deployed,
    skipValidate,
  );
  if (!reviewedFee) {
    return { resourceBounds: estimate.resourceBounds, tip: "0x0" };
  }
  const authorized = authorizedSpendFor(estimate, "standard");
  if (!authorized || exceedsReviewedFee(reviewedFee, authorized)) {
    throw new WalletError(
      "The network fee for this declaration rose above the amount you reviewed. Nothing was submitted — review it again.",
    );
  }
  return { resourceBounds: estimate.resourceBounds, tip: "0x0" };
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
    isAuthorized,
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
      const signedHashes: string[] = [];
      const capturingSigner: AccountHashSigner = async (messageHash) => {
        const signature = await signHash(messageHash);
        signedHashes.push(messageHash);
        return signature;
      };
      const starknetAccount = makeAccount(provider, account, capturingSigner);
      const payload = declarePayload({
        compiledClassHash,
        contractClass,
        ...(classHash === undefined ? {} : { classHash }),
      });
      const validateArgent = account.accountContractType === "argent";
      const deployed = await isCompatibleAccountDeployed(provider, account);
      const bounds = await checkedDeclareBounds(
        validateArgent ? argentQueryAccount(provider, account) : (starknetAccount as Account),
        account,
        payload,
        deployed,
        reviewedFee,
        !validateArgent,
      );
      const deployment = deployed
        ? null
        : await ensureAccountDeployed(
            provider,
            starknetAccount,
            account,
            reviewedDeploymentFee,
            () => signedHashes[0],
            isAuthorized,
          );
      const declarationHashIndex = signedHashes.length;
      try {
        if (isAuthorized?.() === false) {
          throw new WalletError("wallet locked");
        }
        const result = await (starknetAccount as Account).declare(
          payload,
          bounds as Parameters<Account["declare"]>[1],
        );
        return acceptedDeclareSubmission(
          result,
          payload.classHash,
          signedHashes[declarationHashIndex],
        );
      } catch (error) {
        return rethrowDeclareAfterDeployment(error, deployment);
      }
    },
    makeProvider,
  );
