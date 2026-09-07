/** Argent account ABI, deployment, and signature primitives pinned by release. */

import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isOwnDataProperty, isRecord } from "@bramble/core/json";
import {
  type AccountContractType,
  ARGENT_ACCOUNT_CLASS_HASH,
} from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { StarkSignature } from "@bramble/wallet-model/signing";
import { hash, shortString } from "starknet";

const ARGENT_UPSTREAM_COMMIT = "1352198956f36fb35fa544c4e46a3507a3ec20e3";

/**
 * Pinned Argent Account 0.4 declaration from the update-2024Q2 release.
 */
export const ARGENT_ACCOUNT_CONTRACT = {
  classHash: ARGENT_ACCOUNT_CLASS_HASH,
  compiledClassHash: "0x0294a323246c017d00a98f11942e1e38d562c97bc79426742110a14ce497e9b5",
  upstreamCommit: ARGENT_UPSTREAM_COMMIT,
  version: "0.4.0",
} as const;

/**
 * Pinned Argent Multisig 0.2 declaration from the update-2024Q2 release.
 */
export const ARGENT_MULTISIG_CONTRACT = {
  classHash: "0x07aeca3456816e3b833506d7cc5c1313d371fbdb0ae95ee70af72a4ddbf42594",
  compiledClassHash: "0x010972dc21f31635a6e90d524295e4e356a565e21dd1dbe986c476dbe9d0f8c9",
  upstreamCommit: ARGENT_UPSTREAM_COMMIT,
  version: "0.2.0",
} as const;

/**
 * Maximum signer count enforced by Argent Multisig 0.2.
 */
export const ARGENT_MULTISIG_MAX_SIGNERS = 32;

/**
 * Canonical signer set and threshold accepted by Argent Multisig 0.2.
 */
export type ArgentMultisigConfig = {
  readonly signerPublicKeys: readonly string[];
  readonly threshold: number;
};

const felt = (value: string, label: string): string => {
  const canonical = canonicalFelt(value);
  if (canonical === null || !isNonZeroStarkFieldElement(canonical)) {
    throw new WalletError(`Invalid ${label}`);
  }
  return canonical;
};

/**
 * Computes the Argent signer GUID used for membership and signature ordering.
 */
export const argentSignerGuid = (publicKey: string): string => {
  const guid = canonicalFelt(
    hash.computePoseidonHash(
      shortString.encodeShortString("Starknet Signer"),
      felt(publicKey, "signer public key"),
    ),
  );
  if (guid === null || !isNonZeroStarkFieldElement(guid)) {
    throw new WalletError("Invalid signer GUID");
  }
  return guid;
};

/**
 * Validates, de-duplicates, and GUID-sorts an Argent multisig configuration.
 */
export const normalizeArgentMultisigConfig = (
  config: ArgentMultisigConfig,
): ArgentMultisigConfig => {
  if (
    !isRecord(config) ||
    !hasOnlyKnownKeys(config, ["signerPublicKeys", "threshold"]) ||
    !Object.hasOwn(config, "signerPublicKeys") ||
    !Object.hasOwn(config, "threshold")
  ) {
    throw new WalletError("Invalid Argent multisig configuration");
  }
  const signerPublicKeys = config.signerPublicKeys;
  if (
    !Number.isSafeInteger(config.threshold) ||
    config.threshold < 1 ||
    !Array.isArray(signerPublicKeys) ||
    signerPublicKeys.length < 1 ||
    signerPublicKeys.length > ARGENT_MULTISIG_MAX_SIGNERS ||
    config.threshold > signerPublicKeys.length
  ) {
    throw new WalletError("Invalid Argent multisig threshold or signer count");
  }
  const signers: string[] = [];
  for (let index = 0; index < signerPublicKeys.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(signerPublicKeys, index);
    if (!isOwnDataProperty(descriptor) || typeof descriptor.value !== "string") {
      throw new WalletError("Invalid Argent multisig signer public key");
    }
    signers.push(felt(descriptor.value, "signer public key"));
  }
  if (new Set(signers).size !== signers.length) {
    throw new WalletError("Argent multisig signers must be unique");
  }
  if (new Set(signers.map(argentSignerGuid)).size !== signers.length) {
    throw new WalletError("Argent multisig signer GUIDs must be unique");
  }
  signers.sort((left, right) => {
    const leftGuid = BigInt(argentSignerGuid(left));
    const rightGuid = BigInt(argentSignerGuid(right));
    return leftGuid < rightGuid ? -1 : leftGuid > rightGuid ? 1 : 0;
  });
  return { signerPublicKeys: signers, threshold: config.threshold };
};

/**
 * ABI calldata for `Signer::Starknet(publicKey)`.
 */
export const argentStarknetSignerCalldata = (publicKey: string): readonly string[] => [
  "0",
  felt(publicKey, "signer public key"),
];

/**
 * ABI constructor calldata for Argent Account 0.4 without a guardian.
 */
export const argentAccountConstructorCalldata = (publicKey: string): readonly string[] => [
  ...argentStarknetSignerCalldata(publicKey),
  "1",
];

/**
 * ABI constructor calldata for Argent Multisig 0.2.
 */
export const argentMultisigConstructorCalldata = (
  config: ArgentMultisigConfig,
): readonly string[] => {
  const normalized = normalizeArgentMultisigConfig(config);
  return [
    normalized.threshold.toString(),
    normalized.signerPublicKeys.length.toString(),
    ...normalized.signerPublicKeys.flatMap(argentStarknetSignerCalldata),
  ];
};

const contractAddress = (
  salt: string,
  classHash: string,
  constructorCalldata: readonly string[],
): string => {
  const canonicalSalt = canonicalFelt(salt);
  if (canonicalSalt === null) {
    throw new WalletError("Invalid account deployment salt");
  }
  return hash.calculateContractAddressFromHash(
    canonicalSalt,
    classHash,
    [...constructorCalldata],
    0,
  );
};

/**
 * Computes a deterministic Argent Account 0.4 address.
 */
export const argentAccountAddress = (publicKey: string, salt = publicKey): string =>
  contractAddress(
    salt,
    ARGENT_ACCOUNT_CONTRACT.classHash,
    argentAccountConstructorCalldata(publicKey),
  );

/**
 * Computes a deterministic Argent Multisig 0.2 address.
 */
export const argentMultisigAddress = (config: ArgentMultisigConfig, salt: string): string =>
  contractAddress(
    salt,
    ARGENT_MULTISIG_CONTRACT.classHash,
    argentMultisigConstructorCalldata(config),
  );

const checkedSignature = (signature: StarkSignature): StarkSignature => ({
  publicKey: felt(signature.publicKey, "signature public key"),
  r: felt(signature.r, "signature r"),
  s: felt(signature.s, "signature s"),
});

const serializeSignerSignature = (signature: StarkSignature): readonly string[] => {
  const checked = checkedSignature(signature);
  return ["0", checked.publicKey, checked.r, checked.s];
};

/**
 * Standard Argent Account signature: one signer enum plus its public key and `(r,s)`.
 */
export const serializeArgentAccountSignature = (signature: StarkSignature): readonly string[] => [
  "1",
  ...serializeSignerSignature(signature),
];

/**
 * Serializes one signer result for the selected single-signer account contract.
 */
export const serializeAccountSignature = (
  accountContractType: AccountContractType,
  signature: StarkSignature,
): readonly string[] => {
  if (accountContractType === "argent") {
    return serializeArgentAccountSignature(signature);
  }
  const checked = checkedSignature(signature);
  return [checked.r, checked.s];
};

const checkedMemberSignatures = (
  signatures: readonly StarkSignature[],
  config: ArgentMultisigConfig,
  expectedCount: number,
): readonly StarkSignature[] => {
  const normalized = normalizeArgentMultisigConfig(config);
  if (signatures.length !== expectedCount) {
    throw new WalletError(`Argent multisig requires exactly ${expectedCount} signature(s)`);
  }
  const members = new Set(normalized.signerPublicKeys);
  const checked = signatures.map(checkedSignature);
  if (checked.some((signature) => !members.has(signature.publicKey))) {
    throw new WalletError("Argent multisig signature is not from a configured signer");
  }
  if (new Set(checked.map((signature) => signature.publicKey)).size !== checked.length) {
    throw new WalletError("Argent multisig signatures must use distinct signers");
  }
  return [...checked].sort((left, right) => {
    const leftGuid = BigInt(argentSignerGuid(left.publicKey));
    const rightGuid = BigInt(argentSignerGuid(right.publicKey));
    return leftGuid < rightGuid ? -1 : leftGuid > rightGuid ? 1 : 0;
  });
};

/**
 * Exact threshold aggregate required for normal Argent Multisig validation.
 */
export const serializeArgentMultisigSignature = (
  signatures: readonly StarkSignature[],
  config: ArgentMultisigConfig,
): readonly string[] => {
  const checked = checkedMemberSignatures(signatures, config, config.threshold);
  return [checked.length.toString(), ...checked.flatMap(serializeSignerSignature)];
};

/**
 * Single configured-member signature required by Multisig `DEPLOY_ACCOUNT`.
 */
export const serializeArgentMultisigDeploySignature = (
  signature: StarkSignature,
  config: ArgentMultisigConfig,
): readonly string[] => [
  "1",
  ...checkedMemberSignatures([signature], config, 1).flatMap(serializeSignerSignature),
];

/**
 * Returns whether a class hash is the pinned Argent Account 0.4 class.
 */
export const isArgentAccountClassHash = (classHash: string): boolean =>
  sameFelt(classHash, ARGENT_ACCOUNT_CONTRACT.classHash);

/**
 * Returns whether a class hash is the pinned Argent Multisig 0.2 class.
 */
export const isArgentMultisigClassHash = (classHash: string): boolean =>
  sameFelt(classHash, ARGENT_MULTISIG_CONTRACT.classHash);
