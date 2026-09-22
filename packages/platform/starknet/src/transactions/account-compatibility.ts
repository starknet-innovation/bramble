/**
 * Policy for whether an account that already exists on chain is one this wallet
 * may drive.
 *
 * Kept apart from ./deployment because it answers a different question —
 * deployment decides how to create an account, this decides whether an existing
 * one can be acted for — and because it takes only the fields it reads rather
 * than a whole account type, so neither module depends on the other.
 */
import { WalletError } from "@bramble/core/errors";
import { accountClassEntry } from "@bramble/wallet-model/account-families";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import { requireAuthorizableFamily } from "../accounts/account-contracts";
import { isContractNotFoundError } from "../rpc/rpc-not-found";

/** The account fields the signer check reads. */
export type ArgentSignerSubject = {
  readonly address: string;
  readonly publicKeyX: string;
};

/**
 * The hash of the latest accepted block, so every read behind one compatibility
 * decision sees the same state. A pending or shifting block could otherwise
 * report a class and an owner that never coexisted.
 */
export const acceptedBlockIdentifier = async (provider: RpcProvider): Promise<string> => {
  const latest = await provider.getBlockLatestAccepted();
  const blockHash = canonicalFelt(latest.block_hash);
  if (blockHash === null || !isNonZeroStarkFieldElement(blockHash)) {
    throw new WalletError("RPC returned an invalid accepted Starknet block hash");
  }
  return blockHash;
};

/**
 * The account fields needed to decide whether this wallet can encode an
 * authorization the account will accept.
 */
export type AuthorizableAccount = {
  readonly accountContractType: string;
  readonly address: string;
  readonly classHash: string;
};

/**
 * Refuses an account whose live class this wallet cannot encode an authorization for.
 *
 * Typed data and the privacy relay otherwise serialize from the family alone,
 * and every Argent family emits the 0.4 signer-array encoding. An account that
 * was deployed at 0.3.x and has not upgraded cannot verify that authorization.
 * Transaction submission already checks the class the account runs now; these
 * routes must do the same. When nothing is deployed, the stored class is the
 * one a deployment would use, so it is checked instead.
 */
export const requireLiveAuthorizableClass = async (
  provider: RpcProvider,
  account: AuthorizableAccount,
): Promise<void> => {
  requireAuthorizableFamily(account.accountContractType);
  if (account.accountContractType !== "argent") {
    return;
  }
  const blockIdentifier = await acceptedBlockIdentifier(provider);
  try {
    const liveClassHash = await provider.getClassHashAt(account.address, blockIdentifier);
    requireAuthorizableArgentClass(liveClassHash);
  } catch (error) {
    if (!isContractNotFoundError(error)) {
      throw error;
    }
    requireAuthorizableArgentClass(account.classHash);
  }
};

/**
 * Refuses a live class this wallet cannot safely act for.
 *
 * An account's address is fixed by the class it was DEPLOYED with, but the class
 * it RUNS can change — upgrading is routine, and Ready moved its users through
 * exactly that — so requiring equality with the stored class refuses accounts
 * that work perfectly well.
 *
 * Recognising the class is not enough to accept it either: authorization
 * encodings differ by version, and emitting the wrong one builds a transaction
 * the account rejects. So the live class must be both known and one this wallet
 * can authorize for. The two refusals are worded apart because "we do not know
 * this class" and "we know it but cannot act for it" lead a user elsewhere.
 */
export const requireAuthorizableArgentClass = (classHash: string): void => {
  const deployed = accountClassEntry(classHash);
  if (deployed === null || deployed.family !== "argent") {
    throw new WalletError("Deployed Argent account class is not a release this wallet recognizes");
  }
  if (deployed.authorizationShape !== "argent-signer-array") {
    throw new WalletError(
      `Deployed Argent account class (${deployed.label}) expects an authorization format this wallet does not produce`,
    );
  }
};

/**
 * Refuses a deployed Argent account whose on-chain owner is not this wallet's
 * signer, whose owner is an unsupported signer kind, or which carries a
 * guardian. A guardian is a second required approver the recovery phrase cannot
 * supply, so an account holding one must not be treated as signable here.
 */
export const requireCompatibleArgentSigner = async (
  provider: RpcProvider,
  account: ArgentSignerSubject,
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
