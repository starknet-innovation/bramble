/**
 * Counterfactual account deployment: address-proven DEPLOY_ACCOUNT parameters
 * plus status reads and submissions for OpenZeppelin accounts.
 */

import { WalletError } from "@mc-wallet/core/errors";
import {
  isNonZeroStarkFieldElement,
  STARKNET_NETWORKS,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";
import { type Account, CallData, hash, type RpcProvider } from "starknet";
import {
  ARGENT_ACCOUNT_CONTRACT,
  ARGENT_MULTISIG_CONTRACT,
  argentAccountConstructorCalldata,
  argentMultisigConstructorCalldata,
  ML_DSA_ADDRESS_SALT,
  usesValidatedQueryEstimate,
} from "../accounts/account-contracts";
import {
  authorizedSpendFor,
  exceedsReviewedFee,
  type FeeEstimate,
  reviewedSpendFor,
} from "../rpc/fee-bounds";
import {
  type AccountSignerOptions,
  type AggregateHashSigner,
  acceptedRpcWriteHash,
  estimatingAccountFor,
  IndeterminateRpcWriteError,
  isTransportRpcError,
  krustyAccount,
  type MlDsaCalldata,
  matchingAcceptedRpcWriteHash,
  withRpcFallback,
  withRpcWrite,
} from "../rpc/provider";
import {
  type ArgentMultisigDeploymentAccount,
  type DeployableAccount,
  isAccountDeployed,
  isCompatibleAccountDeployed,
} from "./deployment-compatibility";

/**
 * Account shapes this module can deploy, re-exported so
 * `@mc-wallet/starknet/deployment` stays the one import path for the deployment
 * surface. They are defined next to the compatibility checks in
 * `./deployment-compatibility`, which both halves need and which imports nothing
 * back from here, so the two modules stay acyclic.
 */
export type { ArgentMultisigDeploymentAccount, DeployableAccount };

/**
 * DEPLOY_ACCOUNT parameters for a counterfactual wallet account.
 */
export type AccountDeployment = {
  readonly addressSalt: string;
  readonly classHash: string;
  readonly constructorCalldata: readonly string[];
  readonly contractAddress: string;
};

const signerOptions = (
  account: DeployableAccount,
  mlDsa?: MlDsaCalldata,
): AccountSignerOptions => ({
  ...(mlDsa ? { mlDsa } : {}),
  ...(account.accountContractType === "argent-multisig" && account.deployment
    ? {
        multisig: {
          signerPublicKeys: account.deployment.signerPublicKeys,
          threshold: account.deployment.threshold,
        },
      }
    : {}),
});

// The per-family constructor inputs, extracted so the address-commitment check
// below stays inside the complexity budget as families are added.
const deploymentInputs = (
  account: DeployableAccount,
): {
  readonly constructorCalldata: readonly string[];
  readonly addressSalts: readonly string[];
} => {
  if (account.accountContractType === "argent-multisig") {
    if (!sameFelt(account.classHash, ARGENT_MULTISIG_CONTRACT.classHash)) {
      throw new WalletError("Argent multisig class hash does not match the pinned release");
    }
    const deployment = account.deployment;
    if (!deployment) {
      throw new WalletError("Imported Argent multisig has no counterfactual deployment parameters");
    }
    return {
      addressSalts: [deployment.salt],
      constructorCalldata: argentMultisigConstructorCalldata({
        signerPublicKeys: deployment.signerPublicKeys,
        threshold: deployment.threshold,
      }),
    };
  }
  if (account.accountContractType === "argent") {
    if (!sameFelt(account.classHash, ARGENT_ACCOUNT_CONTRACT.classHash)) {
      throw new WalletError("Argent account class hash does not match the pinned release");
    }
    return {
      addressSalts: [account.deploymentSalt],
      constructorCalldata: argentAccountConstructorCalldata(account.publicKeyX),
    };
  }
  if (account.accountContractType === "ml-dsa") {
    // `publicKeyX` *is* the constructor argument: enrollment stores the Poseidon
    // commitment to the key's 925-felt packed expansion in that field, which is
    // the same value the contract recomputes on chain from the key each
    // transaction carries. Re-deriving it here would mean expanding the key
    // again — now a call across the WASM boundary — inside a function five other
    // account families call synchronously. The record's own consistency is
    // checked where the record is read, not here.
    return {
      // Nothing but the class and the key distinguishes two accounts of this
      // contract; `accountDeployment` rejects the result unless it reproduces
      // the stored address, so a wrong salt fails loudly rather than silently.
      addressSalts: [ML_DSA_ADDRESS_SALT],
      constructorCalldata: [account.publicKeyX],
    };
  }
  return {
    addressSalts: ["0x0", account.publicKeyX],
    constructorCalldata: CallData.compile([account.publicKeyX]),
  };
};

/**
 * Reconstructs pinned DEPLOY_ACCOUNT inputs only when they reproduce the stored address.
 * Throws on invalid class/configuration or an address-commitment mismatch.
 */
export const accountDeployment = (account: DeployableAccount): AccountDeployment => {
  const { addressSalts, constructorCalldata } = deploymentInputs(account);
  for (const addressSalt of addressSalts) {
    const computed = hash.calculateContractAddressFromHash(
      addressSalt,
      account.classHash,
      [...constructorCalldata],
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

// Returns only bounds within the separately reviewed deployment fee.
const checkedDeploymentBounds = async (
  estimatingAccount: Account,
  payload: Parameters<Account["deployAccount"]>[0],
  reviewedFee: FeeEstimate | undefined,
  skipValidate: boolean,
): Promise<Record<string, unknown>> => {
  if (!reviewedFee) {
    throw new WalletError(REVIEWED_DEPLOYMENT_FEE_REQUIRED);
  }
  const estimate = await estimatingAccount.estimateAccountDeployFee(payload, {
    skipValidate,
    tip: "0x0",
  });
  const authorized = authorizedSpendFor(estimate, "standard");
  if (!authorized || exceedsReviewedFee(reviewedFee, authorized)) {
    throw new WalletError(REVIEWED_DEPLOYMENT_FEE_EXCEEDED);
  }
  return { resourceBounds: estimate.resourceBounds, tip: "0x0" };
};

const deployAccountContract = async (
  starknetAccount: Account,
  account: DeployableAccount,
  reviewedFee?: FeeEstimate,
  estimatingAccount: Account = starknetAccount,
  skipValidate = true,
  isAuthorized?: () => boolean,
  expectedTransactionHash?: () => unknown,
): Promise<DeploySubmission> => {
  const deployment = accountDeployment(account);
  const payload = {
    addressSalt: deployment.addressSalt,
    classHash: deployment.classHash,
    constructorCalldata: [...deployment.constructorCalldata],
    contractAddress: deployment.contractAddress,
  };
  const bounds = await checkedDeploymentBounds(
    estimatingAccount,
    payload,
    reviewedFee,
    skipValidate,
  );
  if (isAuthorized?.() === false) {
    throw new WalletError("wallet locked");
  }
  const submitted = await starknetAccount.deployAccount(
    payload,
    bounds as Parameters<Account["deployAccount"]>[1],
  );
  return {
    transactionHash: expectedTransactionHash
      ? matchingAcceptedRpcWriteHash(submitted.transaction_hash, expectedTransactionHash())
      : acceptedRpcWriteHash(submitted.transaction_hash),
  };
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
 * `isAuthorized`, when supplied, is checked after fee settlement and immediately
 * before the deployment mutation.
 */
export const ensureAccountDeployed = async (
  provider: RpcProvider,
  starknetAccount: Account,
  account: DeployableAccount,
  reviewedFee: FeeEstimate | undefined,
  expectedTransactionHash: () => unknown,
  isAuthorized?: () => boolean,
  mlDsa?: MlDsaCalldata,
): Promise<DeploySubmission | null> => {
  if (await isCompatibleAccountDeployed(provider, account)) {
    return null;
  }
  let submitted: DeploySubmission | null = null;
  try {
    const estimating = estimatingAccountFor(
      provider,
      account,
      starknetAccount,
      signerOptions(account, mlDsa),
    );
    submitted = await deployAccountContract(
      starknetAccount,
      account,
      reviewedFee,
      estimating.account,
      estimating.skipValidate,
      isAuthorized,
      expectedTransactionHash,
    );
    await provider.waitForTransaction(submitted.transactionHash);
    return submitted;
  } catch (error) {
    if (submitted) {
      throw new WalletError(
        `Account deployment was broadcast as ${submitted.transactionHash}, but confirmation is unknown. The following transaction was not submitted; check the deployment on-chain before retrying.`,
      );
    }
    if (error instanceof IndeterminateRpcWriteError) {
      throw new IndeterminateRpcWriteError(
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
  readonly account: DeployableAccount;
  /** Live authorization captured by the privileged caller. */
  readonly isAuthorized?: () => boolean;
  /**
   * The deployment fee a user reviewed. It is mandatory at every deployment
   * submit boundary and absent only on read-only estimate inputs.
   */
  readonly reviewedFee?: FeeEstimate;
  readonly rpcUrls: readonly string[];
  readonly signHash: AggregateHashSigner;
  /** ML-DSA calldata builders; required only by a paired-phone account. */
  readonly mlDsa?: MlDsaCalldata;
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
 * Estimates counterfactual deployment without private signing or broadcast.
 * Argent uses a shape-correct query signature with validation enabled; OZ
 * skips validation so a Ledger review never prompts the device.
 */
export const estimateAccountDeploymentFee = async (
  { account, mlDsa, rpcUrls, signHash }: DeployAccountInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
  makeAccount: typeof krustyAccount = krustyAccount,
): Promise<AccountDeploymentFeeEstimate> =>
  withRpcFallback(
    rpcUrls,
    async (provider) => {
      if (usesValidatedQueryEstimate(account.accountContractType)) {
        await isCompatibleAccountDeployed(provider, account);
      }
      const deployment = accountDeployment(account);
      const estimating = estimatingAccountFor(
        provider,
        account,
        makeAccount(provider, account, signHash, signerOptions(account, mlDsa)),
        signerOptions(account, mlDsa),
      );
      const estimate = await estimating.account.estimateAccountDeployFee(
        {
          addressSalt: deployment.addressSalt,
          classHash: deployment.classHash,
          constructorCalldata: [...deployment.constructorCalldata],
          contractAddress: deployment.contractAddress,
        },
        { skipValidate: estimating.skipValidate, tip: "0x0" },
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
  { account, isAuthorized, mlDsa, reviewedFee, rpcUrls, signHash }: DeployAccountInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
  makeAccount: typeof krustyAccount = krustyAccount,
): Promise<DeploySubmission> =>
  withRpcWrite(
    rpcUrls,
    STARKNET_NETWORKS[account.networkId].chainId,
    async (provider) => {
      if (await isCompatibleAccountDeployed(provider, account)) {
        throw new WalletError("Account is already deployed");
      }
      let signedHash: string | undefined;
      const authorizedSigner: AggregateHashSigner = async (messageHash) => {
        const signature = await signHash(messageHash);
        if (isAuthorized?.() === false) {
          throw new WalletError("wallet locked");
        }
        signedHash = messageHash;
        return signature;
      };
      const starknetAccount = makeAccount(
        provider,
        account,
        authorizedSigner,
        signerOptions(account, mlDsa),
      );
      const estimating = estimatingAccountFor(
        provider,
        account,
        starknetAccount,
        signerOptions(account, mlDsa),
      );
      const submitted = await deployAccountContract(
        starknetAccount,
        account,
        reviewedFee,
        estimating.account,
        estimating.skipValidate,
        isAuthorized,
        () => signedHash,
      );
      return submitted;
    },
    makeProvider,
  );
