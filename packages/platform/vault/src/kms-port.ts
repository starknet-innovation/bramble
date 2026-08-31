/**
 * Privileged cryptographic capability required by the encrypted vault.
 */
import type { StarkSignature } from "@mc-wallet/wallet-model/signing";

/** Authenticated public application data recovered inside Krusty. */
export type NostrApplicationData = {
  readonly content: string;
  readonly identifier: string;
  readonly senderPublicKey: string;
};

/**
 * Stark key material returned only inside privileged vault flows.
 */
export type StarkKeypair = {
  readonly privateKey: string;
  readonly publicKeyX: string;
  readonly publicKeyY: string;
};

/**
 * Minimum cryptographic capability required by the privileged vault. Concrete
 * implementations must validate every input and output and fail closed.
 */
export type KmsPort = {
  readonly deriveNostrPublicKey: (
    mnemonic: string,
    addressIndex: number,
    accountIndex: number,
    passphrase?: string,
  ) => Promise<string>;
  readonly deriveOzAccountAddress: (
    publicKeyX: string,
    classHash: string,
    salt?: string,
  ) => Promise<string>;
  readonly deriveStrk20ViewingKey: (
    privateKey: string,
    chainId: string,
    poolAddress: string,
  ) => Promise<string>;
  readonly deriveStarknetKeypair: (
    mnemonic: string,
    addressIndex: number,
    accountIndex: number,
    passphrase?: string,
  ) => Promise<StarkKeypair>;
  readonly generateMnemonic: (wordCount?: number) => Promise<string>;
  readonly getAccountClassHashes: () => Promise<string>;
  readonly signStarkHash: (privateKey: string, messageHash: string) => Promise<StarkSignature>;
  readonly openNostrApplicationData: (
    mnemonic: string,
    addressIndex: number,
    accountIndex: number,
    eventJson: string,
    passphrase?: string,
  ) => Promise<NostrApplicationData>;
  readonly validateMnemonic: (mnemonic: string) => Promise<boolean>;
  readonly wrapNostrApplicationData: (
    mnemonic: string,
    addressIndex: number,
    accountIndex: number,
    recipientPublicKey: string,
    identifier: string,
    content: string,
    passphrase?: string,
  ) => Promise<string>;
  /**
   * The Poseidon commitment to an ML-DSA-65 public key's 925-felt packed
   * expansion — the paired-phone account contract's entire constructor argument,
   * and therefore half of its address preimage. Derived rather than stored: the
   * contract recomputes the same value on chain from the key each transaction
   * carries, so a second copy could only ever disagree.
   */
  readonly mlDsaKeyCommitment: (publicKey: string) => Promise<string>;
  /**
   * Whether an ML-DSA-65 signature verifies over `transactionHash` under
   * `publicKey`. Answers `false` on malformed input rather than rejecting, so a
   * caller gating a broadcast gets one decision it can trust.
   */
  readonly mlDsaVerify: (
    publicKey: string,
    transactionHash: string,
    signature: string,
  ) => Promise<boolean>;
  /**
   * The full account signature calldata for one transaction: the packed key, the
   * felt-native signature, and the witnesses the on-chain check runs against.
   * Rejects rather than answering with calldata whose identity could not be
   * proven, because the contract refuses a wrong one with no diagnosis.
   */
  readonly mlDsaSignaturePayload: (
    publicKey: string,
    transactionHash: string,
    signature: string,
  ) => Promise<readonly string[]>;
  /**
   * Well-formed calldata that verifies against nothing, for fee estimation.
   * Lets an estimate run the account's real validation cost without asking the
   * phone to sign anything.
   */
  readonly mlDsaEstimationSignature: (publicKey: string) => Promise<readonly string[]>;
};
