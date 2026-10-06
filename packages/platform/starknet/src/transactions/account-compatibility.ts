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
import type { RecoverySigningRestriction } from "@bramble/wallet-model/recovery";
import type { RpcProvider } from "starknet";

import { withRpcFallback } from "../rpc/provider";
import { isBlockNotFoundError, isContractNotFoundError } from "../rpc/rpc-not-found";
import {
  braavosSignerVerdict,
  isBraavosSigningClass,
  requireBraavosSigningClass,
  requireCompatibleBraavosSigner,
} from "./braavos-compatibility";

/** The account fields the signer check reads. */
type ArgentSignerSubject = {
  readonly address: string;
  readonly publicKeyX: string;
};

/**
 * The hash of the latest accepted block, so every read behind one compatibility
 * decision sees the same state. A pending or shifting block could otherwise
 * report a class and an owner that never coexisted.
 */
const acceptedBlockIdentifier = async (provider: RpcProvider): Promise<string> => {
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
  readonly publicKeyX: string;
};

// A pinned block hash misses about one read in eight on a load-balanced
// endpoint. Three re-pins cover that skew; a persistent miss fails closed.
const LIVE_CLASS_READ_ATTEMPTS = 3;

// Runs every read behind one decision at a freshly pinned accepted block. The
// pin and a read can land on different nodes behind one load-balanced
// endpoint; a sibling that has not seen the pin answers JSON-RPC 24. That is
// skew, not chain state, so the whole decision re-pins and runs again. Any
// other failure, and a miss on every attempt, propagates.
const atAcceptedBlock = async <T>(
  provider: RpcProvider,
  decide: (blockIdentifier: string) => Promise<T>,
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < LIVE_CLASS_READ_ATTEMPTS; attempt += 1) {
    const blockIdentifier = await acceptedBlockIdentifier(provider);
    try {
      return await decide(blockIdentifier);
    } catch (error) {
      if (!isBlockNotFoundError(error)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError;
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
 *
 * Every read sits at one accepted block, re-pinned when a load-balanced
 * sibling has not seen it yet (JSON-RPC 24); a persistent miss fails closed.
 */
export const requireLiveAuthorizableClass = async (
  provider: RpcProvider,
  account: AuthorizableAccount,
): Promise<void> => {
  if (account.accountContractType === "braavos") {
    // Braavos: the live class must be an implementation release this wallet
    // signs for, the wallet key the first stark signer, and no strong signer
    // (2FA/3FA) active. An undeployed Braavos account has no contract to
    // verify an authorization, so absence refuses (the read's own error).
    await atAcceptedBlock(provider, async (blockIdentifier) => {
      const liveClassHash = await provider.getClassHashAt(account.address, blockIdentifier);
      requireBraavosSigningClass(liveClassHash);
      await requireCompatibleBraavosSigner(provider, account, blockIdentifier);
    });
    return;
  }
  if (account.accountContractType !== "argent") {
    return;
  }
  await atAcceptedBlock(provider, async (blockIdentifier) => {
    let liveClassHash: string;
    try {
      liveClassHash = await provider.getClassHashAt(account.address, blockIdentifier);
    } catch (error) {
      if (!isContractNotFoundError(error)) {
        throw error;
      }
      liveClassHash = account.classHash;
    }
    requireAuthorizableArgentClass(liveClassHash);
  });
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
const requireAuthorizableArgentClass = (classHash: string): void => {
  const deployed = accountClassEntry(classHash);
  if (deployed === null || deployed.family !== "argent") {
    throw new WalletError("Deployed Argent account class is not a release this wallet recognizes");
  }
  if (deployed.authorizationShape !== "argent-signer-array") {
    // Fixed text, not templated with the release label: the reader-facing
    // translation table matches diagnostics exactly (see friendly-error-copy).
    throw new WalletError(
      "Deployed Argent account class expects an authorization format this wallet does not produce",
    );
  }
};

/**
 * Advisory signability classification for the recovery scan (issue 542): reads
 * the live class and signer state at the latest block and names the first
 * reason this wallet could not authorize for the account, or null when it
 * could. Advisory only — a wrong or missing answer mislabels a picker row but
 * never moves funds, because the transaction path keeps the authoritative
 * fail-closed checks below.
 */
export const argentSigningRestriction = async (
  provider: RpcProvider,
  account: { readonly address: string; readonly publicKeyX: string },
): Promise<RecoverySigningRestriction | null> => {
  const liveClass = await provider.getClassHashAt(account.address, "latest");
  const entry = accountClassEntry(liveClass);
  if (
    entry === null ||
    entry.family !== "argent" ||
    entry.authorizationShape !== "argent-signer-array"
  ) {
    return "release";
  }
  const read = (entrypoint: string) =>
    provider.callContract({ calldata: [], contractAddress: account.address, entrypoint }, "latest");
  const [owner, ownerType, guardian] = await Promise.all([
    read("get_owner"),
    read("get_owner_type"),
    read("get_guardian"),
  ]);
  const [ownerKey] = owner;
  if (
    owner.length !== 1 ||
    typeof ownerKey !== "string" ||
    !sameFelt(ownerKey, account.publicKeyX)
  ) {
    return "owner-changed";
  }
  if (ownerType.length !== 1 || !sameFelt(ownerType[0], "0x0")) {
    return "owner-type";
  }
  if (guardian.length !== 1 || !sameFelt(guardian[0], "0x0")) {
    return "guardian";
  }
  return null;
};

/**
 * Advisory signability classification for a deployed Braavos recovery
 * candidate: the live class must be a Braavos implementation release this
 * wallet signs for, the stark key the account's first stark signer, and any
 * active strong signer (2FA/3FA) marks the account view-only — unless a
 * deferred-removal request has already expired by the latest block's
 * timestamp. Advisory only; the same rules run fail-closed at a pinned block
 * through {@link requireLiveAuthorizableClass} and
 * {@link isCompatibleAccountDeployed}.
 */
export const braavosSigningRestriction = async (
  provider: RpcProvider,
  account: { readonly address: string; readonly publicKeyX: string },
): Promise<RecoverySigningRestriction | null> => {
  const liveClass = await provider.getClassHashAt(account.address, "latest");
  if (!isBraavosSigningClass(liveClass)) {
    return "release";
  }
  return braavosSignerVerdict(provider, account, "latest");
};

/**
 * Refuses a deployed Argent account whose on-chain owner is not this wallet's
 * signer, whose owner is an unsupported signer kind, or which carries a
 * guardian. A guardian is a second required approver the recovery phrase cannot
 * supply, so an account holding one must not be treated as signable here.
 */
const requireCompatibleArgentSigner = async (
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

/** Input for the advisory recovery-scan signability probe (issue 542). */
export type SigningRestrictionInput = {
  readonly accountAddress: string;
  readonly publicKeyX: string;
  readonly rpcUrls: readonly string[];
};

/**
 * Advisory signability probe for a deployed Argent recovery candidate, with
 * the standard endpoint fallback. Throws on an invalid address or when every
 * endpoint fails; callers treat any throw as "no verdict" since the
 * transaction path re-checks authoritatively.
 */
/**
 * Advisory Braavos signability probe with the standard endpoint fallback; a
 * throw means "no verdict" to callers, never a signing decision.
 */
export const getBraavosSigningRestriction = async (
  { accountAddress, publicKeyX, rpcUrls }: SigningRestrictionInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<RecoverySigningRestriction | null> => {
  if (!isNonZeroStarkFieldElement(accountAddress) || !isNonZeroStarkFieldElement(publicKeyX)) {
    throw new WalletError("Invalid account address");
  }
  return withRpcFallback(
    rpcUrls,
    (provider) => braavosSigningRestriction(provider, { address: accountAddress, publicKeyX }),
    makeProvider,
  );
};

/**
 * Advisory Argent signability probe with the standard endpoint fallback; a
 * throw means "no verdict" to callers, never a signing decision.
 */
export const getArgentSigningRestriction = async (
  { accountAddress, publicKeyX, rpcUrls }: SigningRestrictionInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<RecoverySigningRestriction | null> => {
  if (!isNonZeroStarkFieldElement(accountAddress) || !isNonZeroStarkFieldElement(publicKeyX)) {
    throw new WalletError("Invalid account address");
  }
  return withRpcFallback(
    rpcUrls,
    (provider) => argentSigningRestriction(provider, { address: accountAddress, publicKeyX }),
    makeProvider,
  );
};

/**
 * The fields the deployed-compatibility gate reads. `publicKeyX` is required
 * exactly for the single-signer vendor families whose live signer it checks;
 * an Argent multisig matches on its pinned class alone.
 */
export type DeployedCompatibilitySubject = {
  readonly accountContractType: string;
  readonly address: string;
  readonly classHash: string;
  readonly publicKeyX?: string;
};

const requireSignerSubject = (account: DeployedCompatibilitySubject): ArgentSignerSubject => {
  const { publicKeyX } = account;
  if (publicKeyX === undefined) {
    throw new WalletError("Account public key unavailable for the live signer check");
  }
  return { address: account.address, publicKeyX };
};

// The class deployed at an address, or null when nothing is: no contract, or
// (unless `anyClass`, for existence-only checks) the zero class. A class hash
// that is not a felt is a broken RPC answer and throws.
const deployedClassAt = async (
  provider: RpcProvider,
  address: string,
  blockIdentifier: string,
  anyClass = false,
): Promise<string | null> => {
  let classHash: string;
  try {
    classHash = await provider.getClassHashAt(address, blockIdentifier);
  } catch (error) {
    if (isContractNotFoundError(error)) {
      return null;
    }
    throw error;
  }
  if (anyClass) {
    return classHash;
  }
  if (sameFelt(classHash, "0x0")) {
    return null;
  }
  if (!isNonZeroStarkFieldElement(classHash)) {
    throw new WalletError("RPC returned an invalid Argent account class hash");
  }
  return classHash;
};

/**
 * Whether the account is deployed in a state this wallet can submit for.
 *
 * OpenZeppelin is existence-only and an Argent multisig must run exactly its
 * pinned class; both are single reads at `latest`. Argent and Braavos read
 * class and signer state at one accepted block (re-pinned on JSON-RPC 24 skew)
 * and refuse malformed or incompatible state before signing or broadcast.
 * Undeployed (no contract, or class 0x0) answers false for every family.
 */
export const isCompatibleAccountDeployed = async (
  provider: RpcProvider,
  account: DeployedCompatibilitySubject,
): Promise<boolean> => {
  if (account.accountContractType === "openzeppelin") {
    return (await deployedClassAt(provider, account.address, "latest", true)) !== null;
  }
  if (account.accountContractType === "argent-multisig") {
    const classHash = await deployedClassAt(provider, account.address, "latest");
    if (classHash === null) {
      return false;
    }
    // A multisig's configuration is bound to its exact class, so equality is
    // the right test there and stays as it was.
    if (!sameFelt(classHash, account.classHash)) {
      throw new WalletError("Deployed Argent multisig class does not match the pinned release");
    }
    return true;
  }
  return atAcceptedBlock(provider, async (blockIdentifier) => {
    const classHash = await deployedClassAt(provider, account.address, blockIdentifier);
    if (classHash === null) {
      return false;
    }
    const subject = requireSignerSubject(account);
    if (account.accountContractType === "braavos") {
      requireBraavosSigningClass(classHash);
      await requireCompatibleBraavosSigner(provider, subject, blockIdentifier);
      return true;
    }
    requireAuthorizableArgentClass(classHash);
    await requireCompatibleArgentSigner(provider, subject, blockIdentifier);
    return true;
  });
};
