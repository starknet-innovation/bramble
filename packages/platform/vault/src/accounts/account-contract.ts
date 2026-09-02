/** Supported account-contract address derivation at the vault boundary. */

import { WalletError } from "@mc-wallet/core/errors";
import { isRecord } from "@mc-wallet/core/json";
import {
  ARGENT_ACCOUNT_CONTRACT,
  argentAccountAddress,
  mlDsaAccountAddress,
} from "@mc-wallet/starknet/account-contracts";
import type { AccountContractType } from "@mc-wallet/wallet-model/accounts";
import { isAccountContractType, ML_DSA_ACCOUNT_CLASS_HASH } from "@mc-wallet/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";
import type { KmsPort } from "../kms-port";

const OZ_ACCOUNT_VERSION = "3.0.0";

const parseClassHashes = (json: string): unknown => {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new WalletError("Krusty KMS returned invalid class hash JSON");
  }
};

const ownValue = (record: Record<string, unknown>, field: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(record, field);
  return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
};

// The OZ `AccountUpgradeable` class `starknet-devnet` predeclares. Krusty keys
// its hashes by declaring chain and has no devnet entry, and a devnet declares
// only its own build, so Krusty's hash fails estimation there. Same preset and
// `constructor(public_key: felt252)`, so derivation is unchanged. Devnet-VERSION
// specific and pinned by no CI gate — re-read `devnet_getConfig` after upgrades.
const DEVNET_OZ_ACCOUNT_CLASS_HASH =
  "0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564";

/**
 * Reads the OpenZeppelin account class hash: Krusty's declaration for the real
 * chains, the node's own predeclared class for devnet. Declaredness is not
 * proven here, so a devnet on a different build — or an Argent account on any
 * devnet — still fails at fee estimation.
 */
export const getOzAccountClassHash = async (
  kms: KmsPort,
  networkId: StarknetNetworkId,
): Promise<string> => {
  if (networkId === "SN_DEVNET") {
    // Validated like Krusty's value below, since the constant is hand-updated.
    if (!isNonZeroStarkFieldElement(DEVNET_OZ_ACCOUNT_CLASS_HASH)) {
      throw new WalletError("Devnet account class hash is invalid");
    }
    return canonicalFelt(DEVNET_OZ_ACCOUNT_CLASS_HASH) as string;
  }

  const hashes = parseClassHashes(await kms.getAccountClassHashes());
  const ozHashes = isRecord(hashes) ? ownValue(hashes, "oz") : null;
  if (!isRecord(ozHashes)) {
    throw new WalletError("Krusty KMS class hashes are missing oz accounts");
  }

  const version = ownValue(ozHashes, OZ_ACCOUNT_VERSION);
  const classHash = isRecord(version) ? ownValue(version, networkId) : null;
  if (typeof classHash !== "string") {
    throw new WalletError(`Krusty KMS class hashes are missing ${networkId}`);
  }
  if (!isNonZeroStarkFieldElement(classHash)) {
    throw new WalletError("Krusty KMS returned an invalid class hash");
  }
  return canonicalFelt(classHash) as string;
};

/**
 * Resolves and validates the class hash for one supported account family.
 */
export const resolveAccountClassHash = async (
  kms: KmsPort,
  input: { readonly accountContractType: AccountContractType; readonly classHash?: string },
  networkId: StarknetNetworkId,
): Promise<string> => {
  if (!isAccountContractType(input.accountContractType)) {
    throw new WalletError("Invalid account contract type");
  }
  if (input.accountContractType === "argent") {
    if (
      input.classHash !== undefined &&
      !sameFelt(input.classHash, ARGENT_ACCOUNT_CONTRACT.classHash)
    ) {
      throw new WalletError("Invalid Argent account class hash");
    }
    return ARGENT_ACCOUNT_CONTRACT.classHash;
  }
  if (input.accountContractType === "ml-dsa") {
    if (input.classHash !== undefined && !sameFelt(input.classHash, ML_DSA_ACCOUNT_CLASS_HASH)) {
      throw new WalletError("Invalid ML-DSA account class hash");
    }
    return ML_DSA_ACCOUNT_CLASS_HASH;
  }
  return input.classHash ?? getOzAccountClassHash(kms, networkId);
};

const resolvedDeploymentSalt = (
  accountContractType: AccountContractType,
  value: string | undefined,
  publicKeyX: string,
): string | undefined => {
  if (accountContractType !== "argent") {
    if (value !== undefined) {
      throw new WalletError("Only Argent accounts accept a deployment salt");
    }
    return undefined;
  }
  const salt = value ?? publicKeyX;
  if (!isStarkFieldElement(salt)) {
    throw new WalletError("Invalid Argent deployment salt");
  }
  return canonicalFelt(salt) as string;
};

// The ML-DSA half of the derivation below, extracted to keep that function
// inside the complexity budget.
//
// This must never fall through to another family's recipe: an address is a
// commitment to a class hash and constructor calldata, so deriving an
// OpenZeppelin address here would return a plausible address nobody holds the
// key for, stranding anything sent to it — exactly what the proof-of-possession
// step in enrollment exists to prevent.
//
// The constructor argument is derived, not stored: `mlDsaKeyCommitment` expands
// the public key to its 925-felt packed form and hashes it, which is the same
// value the contract recomputes on chain from the key each transaction carries.
const mlDsaContractAddress = async (
  kms: KmsPort,
  publicKey: string | undefined,
  classHash: string,
  publicKeyX: string,
): Promise<string> => {
  if (publicKey === undefined) {
    throw new WalletError("ML-DSA account public key is required");
  }
  const commitment = canonicalFelt(await kms.mlDsaKeyCommitment(publicKey));
  // Checked, not assumed. The two are written together at enrollment, so this
  // agrees by construction on a healthy record — but they are read apart:
  // deployment calldata takes `publicKeyX` while signing and verification take
  // `publicKey`. A record where they disagree deploys an account the phone
  // cannot sign for, and the contract rejects every later transaction with no
  // useful error. This is the one place holding both, so it is where they meet.
  if (commitment === null || commitment !== publicKeyX) {
    throw new WalletError("ML-DSA account key does not match its stored identity");
  }
  const address = mlDsaAccountAddress(classHash, commitment);
  if (!isNonZeroStarkFieldElement(address)) {
    throw new WalletError("Invalid ML-DSA account address");
  }
  return canonicalFelt(address) as string;
};

/**
 * Resolves one supported contract class and counterfactual address from an
 * already-public signer key. Invalid inputs and boundary results fail closed.
 */
export const deriveAccountContractAddress = async (
  kms: KmsPort,
  input: {
    readonly accountContractType: AccountContractType;
    readonly classHash?: string;
    readonly deploymentSalt?: string;
    readonly networkId: StarknetNetworkId;
    /** The encoded ML-DSA public key, required only for that family. */
    readonly publicKey?: string;
    readonly publicKeyX: string;
  },
): Promise<{
  readonly address: string;
  readonly classHash: string;
  readonly deploymentSalt?: string;
}> => {
  if (!isStarknetNetworkId(input.networkId)) {
    throw new WalletError("Invalid Starknet network");
  }
  if (!isNonZeroStarkFieldElement(input.publicKeyX)) {
    throw new WalletError("Invalid account public key");
  }
  const classHashInput = await resolveAccountClassHash(kms, input, input.networkId);
  if (!isNonZeroStarkFieldElement(classHashInput)) {
    throw new WalletError("Invalid account class hash");
  }
  const classHash = canonicalFelt(classHashInput) as string;
  const publicKeyX = canonicalFelt(input.publicKeyX) as string;
  const deploymentSalt = resolvedDeploymentSalt(
    input.accountContractType,
    input.deploymentSalt,
    publicKeyX,
  );
  if (input.accountContractType === "ml-dsa") {
    return {
      address: await mlDsaContractAddress(kms, input.publicKey, classHash, publicKeyX),
      classHash,
    };
  }
  const addressInput =
    input.accountContractType === "argent"
      ? argentAccountAddress(publicKeyX, deploymentSalt)
      : await kms.deriveOzAccountAddress(publicKeyX, classHash, "0x0");
  if (!isNonZeroStarkFieldElement(addressInput)) {
    throw new WalletError(
      input.accountContractType === "argent"
        ? "Invalid Argent account address"
        : "Krusty KMS returned invalid account address",
    );
  }
  return {
    address: canonicalFelt(addressInput) as string,
    classHash,
    ...(deploymentSalt === undefined ? {} : { deploymentSalt }),
  };
};
