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
};
