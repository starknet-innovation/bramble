/**
 * Counterfactual account deployment: address-proven DEPLOY_ACCOUNT parameters
 * plus status reads and submissions for OpenZeppelin accounts.
 */

import { WalletError } from "@mc-wallet/core/errors";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import {
  isNonZeroStarkFieldElement,
  STARKNET_NETWORKS,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";
import { type Account, CallData, hash, type RpcProvider } from "starknet";
import {
  authorizedSpendFor,
  exceedsReviewedFee,
  type FeeEstimate,
  reviewedSpendFor,
} from "../rpc/fee-bounds";
import {
  acceptedRpcWriteHash,
  IndeterminateRpcWriteError,
  isContractNotFoundError,
  isTransportRpcError,
  krustyAccount,
  type StarkHashSigner,
  withRpcFallback,
  withRpcWrite,
} from "../rpc/provider";

/**
 * DEPLOY_ACCOUNT parameters for a counterfactual OpenZeppelin account.
 */
export type AccountDeployment = {
  readonly addressSalt: string;
  readonly classHash: string;
  readonly constructorCalldata: readonly string[];
  readonly contractAddress: string;
};

/**
 * Builds OZ DEPLOY_ACCOUNT parameters and proves they reproduce the stored
 * address, so a deployment can never land at a different contract address.
 * Krusty derives counterfactual addresses with salt 0; the public-key salt is
 * also accepted for accounts imported from other derivations.
 */
export const ozAccountDeployment = (account: AccountRef): AccountDeployment => {
  const constructorCalldata = CallData.compile([account.publicKeyX]);
  for (const addressSalt of ["0x0", account.publicKeyX]) {
    const computed = hash.calculateContractAddressFromHash(
      addressSalt,
      account.classHash,
      constructorCalldata,
      0,
    );
    if (sameFelt(computed, account.address)) {
      return {
        addressSalt,
        classHash: account.classHash,
        constructorCalldata,
        contractAddress: account.address,
      };
    }
  }
  throw new WalletError("Account deployment parameters do not match the stored address");
};

/**
 * Reads account deployment status through an already selected provider.
 * Contract-not-found is the only response interpreted as undeployed; every
 * other endpoint failure propagates so callers cannot silently act on an
 * unknown state.
 */
export const isAccountDeployed = async (
  provider: RpcProvider,
  address: string,
): Promise<boolean> => {
  try {
    await provider.getClassHashAt(address, "latest");
    return true;
  } catch (error) {
    if (isContractNotFoundError(error)) {
      return false;
    }
    throw error;
  }
};

/**
 * Refusal shown when a deployment would sign for more than the card that
 * offered it displayed. Separate wording from the invoke refusal because the
 * transaction being refused is one the user did not ask for directly — it is
 * the deployment the wallet submits on their behalf first.
 */
export const REVIEWED_DEPLOYMENT_FEE_EXCEEDED =
  "The account deployment fee rose above the amount you reviewed. Nothing was submitted — review it again.";

/**
 * Refusal when an undeployed account has no separately reviewed deployment
 * ceiling; no deployment is signed or broadcast.
 */
export const REVIEWED_DEPLOYMENT_FEE_REQUIRED =
  "The account deployment fee was not reviewed. Nothing was submitted — deploy the account first.";

// The bounds a deployment signs under. A separately reviewed fee is mandatory:
// the estimate is taken here, the spend its bounds authorise is checked against
// the reviewed figure, and those same bounds are then signed.
const checkedDeploymentBounds = async (
  starknetAccount: Account,
  payload: Parameters<Account["deployAccount"]>[0],
  reviewedFee: FeeEstimate | undefined,
): Promise<Record<string, unknown>> => {
  if (!reviewedFee) {
    throw new WalletError(REVIEWED_DEPLOYMENT_FEE_REQUIRED);
  }
  const estimate = await starknetAccount.estimateAccountDeployFee(payload);
  const authorized = authorizedSpendFor(estimate, "standard");
  if (!authorized || exceedsReviewedFee(reviewedFee, authorized)) {
    throw new WalletError(REVIEWED_DEPLOYMENT_FEE_EXCEEDED);
  }
  return { resourceBounds: estimate.resourceBounds };
};

const deployAccountContract = async (
  starknetAccount: Account,
  account: AccountRef,
  reviewedFee?: FeeEstimate,
): Promise<DeploySubmission> => {
  const deployment = ozAccountDeployment(account);
  const payload = {
    addressSalt: deployment.addressSalt,
    classHash: deployment.classHash,
    constructorCalldata: [...deployment.constructorCalldata],
    contractAddress: deployment.contractAddress,
  };
  const bounds = await checkedDeploymentBounds(starknetAccount, payload, reviewedFee);
  const submitted = await starknetAccount.deployAccount(
    payload,
    bounds as Parameters<Account["deployAccount"]>[1],
  );
  return { transactionHash: acceptedRpcWriteHash(submitted.transaction_hash) };
};

/**
 * Ensures the counterfactual account contract is deployed before invoking.
 *
 * `reviewedFee` is the deployment fee the caller's approval card displayed.
 * It is mandatory whenever deployment is needed and binds the transaction the
 * same way a reviewed invoke fee binds the invoke: a deployment whose cost has
 * outrun it is refused before anything is signed. If the account is already
 * deployed the ceiling is not consumed. The returned submission identifies the
 * deployment this call broadcast; `null` means no deployment was necessary.
 */
export const ensureAccountDeployed = async (
  provider: RpcProvider,
  starknetAccount: Account,
  account: AccountRef,
  reviewedFee?: FeeEstimate,
): Promise<DeploySubmission | null> => {
  if (await isAccountDeployed(provider, account.address)) {
    return null;
  }
  let submitted: DeploySubmission | null = null;
  try {
    submitted = await deployAccountContract(starknetAccount, account, reviewedFee);
    await provider.waitForTransaction(submitted.transactionHash);
    return submitted;
  } catch (error) {
    if (submitted) {
      throw new WalletError(
        `Account deployment was broadcast as ${submitted.transactionHash}, but confirmation is unknown. The following transaction was not submitted; check the deployment on-chain before retrying.`,
      );
    }
    if (error instanceof IndeterminateRpcWriteError) {
      // The account deployment may have landed, but the caller's subsequent
      // invoke/declare definitely has not. Remove the inner write marker so a
      // higher-level maturity guard can safely restore its own operation.
      throw new WalletError(
        "Account deployment status is unknown. Check the account on-chain before retrying.",
      );
    }
    if (error instanceof WalletError) {
      throw error;
    }
    if (isTransportRpcError(error)) {
      throw new WalletError(
        "Account deployment status is unknown. Check the account on-chain before retrying.",
      );
    }
    throw new WalletError(
      "This account is not deployed on-chain yet and automatic deployment failed. Fund the account address with STRK to cover fees, then retry.",
    );
  }
};

/**
 * Inputs for checking whether an account contract is deployed.
 */
export type DeploymentStatusInput = {
  readonly accountAddress: string;
  readonly rpcUrls: readonly string[];
};

/**
 * Inputs for submitting a DEPLOY_ACCOUNT transaction.
 */
export type DeployAccountInput = {
  readonly account: AccountRef;
  /**
   * The deployment fee a user reviewed. It is mandatory at every deployment
   * submit boundary and absent only on read-only estimate inputs.
   */
  readonly reviewedFee?: FeeEstimate;
  readonly rpcUrls: readonly string[];
  readonly signHash: StarkHashSigner;
};

/**
 * Account deployment submission result.
 */
export type DeploySubmission = {
  readonly transactionHash: string;
};

/**
 * Network fee estimate for deploying the wallet account, before signing. The
 * same shape as every other reviewed fee — one definition in `./fee-bounds`,
 * re-exported under the name this surface already uses — so a deployment fee
 * can be carried back into {@link ensureAccountDeployed} as a ceiling without
 * being converted between two structurally identical types on the way.
 */
export type AccountDeploymentFeeEstimate = FeeEstimate;

/**
 * Reads whether an account contract exists on-chain.
 */
export const getDeploymentStatus = async (
  { accountAddress, rpcUrls }: DeploymentStatusInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<boolean> => {
  if (!isNonZeroStarkFieldElement(accountAddress)) {
    throw new WalletError("Invalid account address");
  }
  return withRpcFallback(
    rpcUrls,
    (provider) => isAccountDeployed(provider, accountAddress),
    makeProvider,
  );
};

/**
 * Estimates counterfactual account deployment with validation skipped. This
 * never signs or broadcasts and is safe to use while a dapp approval is still
 * pending.
 */
export const estimateAccountDeploymentFee = async (
  { account, rpcUrls, signHash }: DeployAccountInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
  makeAccount: typeof krustyAccount = krustyAccount,
): Promise<AccountDeploymentFeeEstimate> =>
  withRpcFallback(
    rpcUrls,
    async (provider) => {
      const deployment = ozAccountDeployment(account);
      const estimate = await makeAccount(provider, account, signHash).estimateAccountDeployFee(
        {
          addressSalt: deployment.addressSalt,
          classHash: deployment.classHash,
          constructorCalldata: [...deployment.constructorCalldata],
          contractAddress: deployment.contractAddress,
        },
        { skipValidate: true },
      );
      return reviewedSpendFor(estimate, "standard");
    },
    makeProvider,
  );

/**
 * Signs and submits the DEPLOY_ACCOUNT transaction for a counterfactual
 * account the user explicitly asked to deploy.
 */
export const submitAccountDeployment = async (
  { account, reviewedFee, rpcUrls, signHash }: DeployAccountInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
  makeAccount: typeof krustyAccount = krustyAccount,
): Promise<DeploySubmission> =>
  withRpcWrite(
    rpcUrls,
    STARKNET_NETWORKS[account.networkId].chainId,
    async (provider) => {
      if (await isAccountDeployed(provider, account.address)) {
        throw new WalletError("Account is already deployed");
      }
      return deployAccountContract(makeAccount(provider, account, signHash), account, reviewedFee);
    },
    makeProvider,
  );
