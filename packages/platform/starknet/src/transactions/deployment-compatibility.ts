/**
 * "Is this account already on chain, and is what is there the contract we
 * expect?" — asked before every deployment, declare, and invoke so an account is
 * never deployed twice and a submit never signs against an unexpected class.
 *
 * Split out of `./deployment` because it answers a different question from the
 * one that builds and submits DEPLOY_ACCOUNT, and because only the Argent
 * families pin a deployed class: for the others existence is the whole check,
 * and each family added widens that branch rather than the submit path.
 *
 * Fails closed throughout: only contract-not-found means undeployed, and every
 * other RPC failure propagates so unknown state is never read as absent.
 */

import { WalletError } from "@mc-wallet/core/errors";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";
import type { RpcProvider } from "starknet";
import { pinsDeployedClass } from "../accounts/account-contracts";
import { type ArgentMultisigAccountDescriptor, isContractNotFoundError } from "../rpc/provider";

// These describe an account the wallet could deploy, and both halves of the
// split need them. They live on this side because this module has no import
// back into `./deployment`, which would otherwise be a cycle.
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

const requireCompatibleArgentSigner = async (
  provider: RpcProvider,
  account: Extract<DeployableAccount, { readonly accountContractType: "argent" }>,
  blockIdentifier: string,
): Promise<void> => {
  const readSignerState = (entrypoint: "get_guardian" | "get_owner" | "get_owner_type") =>
    provider.callContract(
      { calldata: [], contractAddress: account.address, entrypoint },
      blockIdentifier,
    );
  const [owner, ownerType] = await Promise.all([
    readSignerState("get_owner"),
    readSignerState("get_owner_type"),
  ]);
  const [ownerPublicKey] = owner;
  if (
    owner.length !== 1 ||
    typeof ownerPublicKey !== "string" ||
    !isNonZeroStarkFieldElement(ownerPublicKey) ||
    !sameFelt(ownerPublicKey, account.publicKeyX)
  ) {
    throw new WalletError("Deployed Argent account owner does not match the wallet signer");
  }
  if (ownerType.length !== 1 || !sameFelt(ownerType[0], "0x0")) {
    throw new WalletError("Deployed Argent account owner type is not supported by this wallet");
  }

  const guardian = await readSignerState("get_guardian");
  if (guardian.length !== 1 || !sameFelt(guardian[0], "0x0")) {
    throw new WalletError("Deployed Argent account guardian is not supported by this wallet");
  }
};

// The pinned-class tail of the check below, extracted to keep that function
// inside the complexity budget now that it branches on more than two families.
const hasPinnedArgentClass = async (
  provider: RpcProvider,
  account: DeployableAccount,
  classHash: string,
  blockIdentifier: string,
): Promise<boolean> => {
  if (sameFelt(classHash, "0x0")) {
    return false;
  }
  if (!isNonZeroStarkFieldElement(classHash)) {
    throw new WalletError("RPC returned an invalid Argent account class hash");
  }
  if (!sameFelt(classHash, account.classHash)) {
    throw new WalletError("Deployed Argent account class does not match the pinned release");
  }
  if (account.accountContractType === "argent") {
    await requireCompatibleArgentSigner(provider, account, blockIdentifier);
  }
  return true;
};

/**
 * Verifies pinned Argent class and supported signer state at one accepted block.
 * Rejects malformed/incompatible state before signing or broadcast; OZ is existence-only.
 */
export const isCompatibleAccountDeployed = async (
  provider: RpcProvider,
  account: DeployableAccount,
): Promise<boolean> => {
  let classHash: string;
  let blockIdentifier = "latest";
  if (account.accountContractType === "argent") {
    const latest = await provider.getBlockLatestAccepted();
    const blockHash = canonicalFelt(latest.block_hash);
    if (blockHash === null || !isNonZeroStarkFieldElement(blockHash)) {
      throw new WalletError("RPC returned an invalid accepted Starknet block hash");
    }
    blockIdentifier = blockHash;
  }
  try {
    classHash = await provider.getClassHashAt(account.address, blockIdentifier);
  } catch (error) {
    if (isContractNotFoundError(error)) {
      return false;
    }
    throw error;
  }
  // Only the Argent families pin a deployed class. Existence is the whole check
  // for the others: OpenZeppelin's class is network-resolved, and the ML-DSA
  // account contract has no pinned release to compare against yet.
  if (!pinsDeployedClass(account.accountContractType)) {
    return true;
  }
  return hasPinnedArgentClass(provider, account, classHash, blockIdentifier);
};
