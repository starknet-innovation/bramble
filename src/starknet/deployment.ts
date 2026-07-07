/**
 * Counterfactual account deployment: address-proven DEPLOY_ACCOUNT parameters
 * plus status reads and submissions for OpenZeppelin accounts.
 */
import { type Account, CallData, hash, type RpcProvider } from "starknet";
import { WalletError } from "../shared/errors";
import type { AccountRef } from "../storage/vault-schema";
import { isNonZeroStarkFieldElement } from "./networks";
import {
  isContractNotFoundError,
  krustyAccount,
  type StarkHashSigner,
  withRpcFallback,
} from "./provider";

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
    if (BigInt(computed) === BigInt(account.address)) {
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

const isAccountDeployed = async (provider: RpcProvider, address: string): Promise<boolean> => {
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
 * Checks whether an account contract exists on-chain (exported for reuse).
 */
export const isAccountDeployedOn = isAccountDeployed;

const deployAccountContract = async (
  starknetAccount: Account,
  account: AccountRef,
): Promise<DeploySubmission> => {
  const deployment = ozAccountDeployment(account);
  const submitted = await starknetAccount.deployAccount({
    addressSalt: deployment.addressSalt,
    classHash: deployment.classHash,
    constructorCalldata: [...deployment.constructorCalldata],
    contractAddress: deployment.contractAddress,
  });
  return { transactionHash: submitted.transaction_hash };
};

/**
 * Ensures the counterfactual account contract is deployed before invoking.
 */
export const ensureAccountDeployed = async (
  provider: RpcProvider,
  starknetAccount: Account,
  account: AccountRef,
): Promise<void> => {
  if (await isAccountDeployed(provider, account.address)) {
    return;
  }
  try {
    const submitted = await deployAccountContract(starknetAccount, account);
    await provider.waitForTransaction(submitted.transactionHash);
  } catch (error) {
    if (error instanceof WalletError) {
      throw error;
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
 * Reads whether an account contract exists on-chain.
 */
export const getDeploymentStatus = async ({
  accountAddress,
  rpcUrls,
}: DeploymentStatusInput): Promise<boolean> => {
  if (!isNonZeroStarkFieldElement(accountAddress)) {
    throw new WalletError("Invalid account address");
  }
  return withRpcFallback(rpcUrls, (provider) => isAccountDeployed(provider, accountAddress));
};

/**
 * Signs and submits the DEPLOY_ACCOUNT transaction for a counterfactual
 * account the user explicitly asked to deploy.
 */
export const submitAccountDeployment = async ({
  account,
  rpcUrls,
  signHash,
}: DeployAccountInput): Promise<DeploySubmission> =>
  withRpcFallback(rpcUrls, async (provider) => {
    if (await isAccountDeployed(provider, account.address)) {
      throw new WalletError("Account is already deployed");
    }
    return deployAccountContract(krustyAccount(provider, account, signHash), account);
  });
