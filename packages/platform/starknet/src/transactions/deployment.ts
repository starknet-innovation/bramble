/**
 * Counterfactual account deployment: address-proven DEPLOY_ACCOUNT parameters
 * plus status reads and submissions for OpenZeppelin accounts.
 */

import { WalletError } from "@bramble/core/errors";
import { BRAAVOS_DEPLOYMENT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import {
  isNonZeroStarkFieldElement,
  STARKNET_NETWORKS,
  sameFelt,
} from "@bramble/wallet-model/networks";
import { type Account, CallData, hash, type RpcProvider } from "starknet";
import {
  ARGENT_ACCOUNT_CONTRACT,
  ARGENT_MULTISIG_CONTRACT,
  argentAccountConstructorCalldata,
  argentMultisigConstructorCalldata,
} from "../accounts/account-contracts";
import {
  authorizedSpendFor,
  exceedsReviewedFee,
  type FeeEstimate,
  reviewedSpendFor,
} from "../rpc/fee-bounds";
import {
  type AccountHashSigner,
  type AccountSignerOptions,
  type ArgentMultisigAccountDescriptor,
  acceptedRpcWriteHash,
  argentQueryAccount,
  IndeterminateRpcWriteError,
  isContractNotFoundError,
  isTransportRpcError,
  krustyAccount,
  matchingAcceptedRpcWriteHash,
  withRpcFallback,
  withRpcWrite,
} from "../rpc/provider";
import { isCompatibleAccountDeployed } from "./account-compatibility";

export { requireLiveAuthorizableClass } from "./account-compatibility";
export { isCompatibleAccountDeployed };

/**
 * DEPLOY_ACCOUNT parameters for a counterfactual wallet account.
 */
export type AccountDeployment = {
  readonly addressSalt: string;
  readonly classHash: string;
  readonly constructorCalldata: readonly string[];
  readonly contractAddress: string;
};

/**
 * Counterfactual constructor commitment retained by the multisig feature.
 */
export type ArgentMultisigDeploymentAccount = ArgentMultisigAccountDescriptor & {
  readonly deployment: {
    readonly salt: string;
    readonly signerPublicKeys: readonly string[];
    readonly threshold: number;
  } | null;
};

/**
 * Any wallet account for which platform code can prove deployment parameters.
 */
export type DeployableAccount = AccountRef | ArgentMultisigDeploymentAccount;

const signerOptions = (account: DeployableAccount): AccountSignerOptions =>
  account.accountContractType === "argent-multisig" && account.deployment
    ? {
        multisig: {
          signerPublicKeys: account.deployment.signerPublicKeys,
          threshold: account.deployment.threshold,
        },
      }
    : {};

const BRAAVOS_DEPLOYMENT_UNSUPPORTED = "This wallet does not deploy Braavos accounts";

// The constructor arguments and candidate salts one family deploys with. Split
// from accountDeployment so each family's rule reads on its own, and so a family
// this wallet never deploys fails here rather than reaching the address check.
const deploymentInputs = (
  account: DeployableAccount,
): {
  readonly addressSalts: readonly string[];
  readonly constructorCalldata: readonly string[];
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
  if (account.accountContractType === "openzeppelin") {
    return {
      addressSalts: ["0x0", account.publicKeyX],
      constructorCalldata: CallData.compile([account.publicKeyX]),
    };
  }
  // Only the deployment class the current Braavos app pins addresses to: the
  // signer carries the implementation out-of-band in the extended deploy
  // signature, and that layout has only been established for this class. An
  // older base-class counterfactual is refused rather than deployed with a
  // signature its constructor may not accept.
  if (sameFelt(account.classHash, BRAAVOS_DEPLOYMENT_CLASS_HASH)) {
    return {
      addressSalts: [account.publicKeyX],
      constructorCalldata: CallData.compile([account.publicKeyX]),
    };
  }
  throw new WalletError(BRAAVOS_DEPLOYMENT_UNSUPPORTED);
};

/**
 * Refusal for a transaction from an undeployed Braavos account. Its deployment
 * is a separate reviewed step, never folded into another transaction.
 */
export const UNDEPLOYED_BRAAVOS_REFUSAL = "Deploy this account first (Settings → Deploy account).";

/**
 * Throws before any signing when an undeployed Braavos account would need a
 * deploy-then-act submission, which only the explicit deployment can produce
 * (its deploy signature signs an extra hash first). An older base class, which
 * this wallet cannot deploy at all, says so instead.
 */
export const refuseUndeployedBraavos = (account: DeployableAccount, deployed: boolean): void => {
  if (deployed || account.accountContractType !== "braavos") return;
  throw new WalletError(
    sameFelt(account.classHash, BRAAVOS_DEPLOYMENT_CLASS_HASH)
      ? UNDEPLOYED_BRAAVOS_REFUSAL
      : BRAAVOS_DEPLOYMENT_UNSUPPORTED,
  );
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
 * Reads status through the selected RPC; only contract-not-found means undeployed.
 * Propagates every other failure so unknown state cannot be treated as absent.
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
): Promise<DeploySubmission | null> => {
  if (await isCompatibleAccountDeployed(provider, account)) {
    return null;
  }
  // `expectedTransactionHash` names the first hash signed, which for Braavos
  // would be the deploy signature's parameters hash, never the broadcast one.
  refuseUndeployedBraavos(account, false);
  let submitted: DeploySubmission | null = null;
  try {
    // Argent accepts a mock query signature; OpenZeppelin skips validation
    // (see submitAccountDeployment). Braavos was refused above.
    const estimatingAccount =
      account.accountContractType === "openzeppelin"
        ? starknetAccount
        : argentQueryAccount(provider, account, signerOptions(account));
    submitted = await deployAccountContract(
      starknetAccount,
      account,
      reviewedFee,
      estimatingAccount,
      account.accountContractType === "openzeppelin",
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
  readonly signHash: AccountHashSigner;
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
  { account, rpcUrls, signHash }: DeployAccountInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
  makeAccount: typeof krustyAccount = krustyAccount,
): Promise<AccountDeploymentFeeEstimate> =>
  withRpcFallback(
    rpcUrls,
    async (provider) => {
      if (account.accountContractType !== "openzeppelin") {
        await isCompatibleAccountDeployed(provider, account);
      }
      const deployment = accountDeployment(account);
      const estimatingAccount =
        account.accountContractType === "openzeppelin" || account.accountContractType === "braavos"
          ? makeAccount(provider, account, signHash, signerOptions(account))
          : argentQueryAccount(provider, account, signerOptions(account));
      const estimate = await estimatingAccount.estimateAccountDeployFee(
        {
          addressSalt: deployment.addressSalt,
          classHash: deployment.classHash,
          constructorCalldata: [...deployment.constructorCalldata],
          contractAddress: deployment.contractAddress,
        },
        { skipValidate: account.accountContractType === "openzeppelin", tip: "0x0" },
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
  { account, isAuthorized, reviewedFee, rpcUrls, signHash }: DeployAccountInput,
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
      const authorizedSigner: AccountHashSigner = async (messageHash) => {
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
        signerOptions(account),
      );
      // Argent skips signature checks on query-version transactions, so a mock
      // query signer estimates with validation on; Braavos validates the deploy
      // signature in its constructor unconditionally, so its estimate must be
      // signed for real — a query-version hash can never be submitted, so the
      // pre-flight signature spends nothing. OpenZeppelin skips validation.
      const estimating =
        account.accountContractType === "openzeppelin" || account.accountContractType === "braavos"
          ? starknetAccount
          : argentQueryAccount(provider, account, signerOptions(account));
      const submitted = await deployAccountContract(
        starknetAccount,
        account,
        reviewedFee,
        estimating,
        account.accountContractType === "openzeppelin",
        isAuthorized,
        () => signedHash,
      );
      return submitted;
    },
    makeProvider,
  );
