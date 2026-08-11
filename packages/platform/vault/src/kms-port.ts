/**
 * Privileged cryptographic capability required by the encrypted vault.
 */
import type { StarkSignature } from "@mc-wallet/wallet-model/signing";

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
  /**
   * Folds a signature over {@link KmsPort.strk20ViewingKeyMessageHash} into a
   * viewing key. The second of the two stages {@link deriveStrk20ViewingKey}
   * composes, exposed so a Ledger — which never reveals its private key — can
   * supply the signature itself and still land on a key this derivation
   * recognizes.
   *
   * The result is secret material: it goes only to the encrypted vault, never to
   * messages, logs, preferences, or UI state.
   */
  readonly foldStrk20ViewingKey: (r: string, s: string) => Promise<string>;
  /**
   * Computes the message a viewing key is derived by signing, for one canonical
   * chain and pool. Carries no secret material — it is a hash of public scope —
   * but the scope must be canonical: the KMS rejects non-shortest-form hex,
   * because two spellings of one pool would derive two different keys.
   */
  readonly strk20ViewingKeyMessageHash: (chainId: string, poolAddress: string) => Promise<string>;
  readonly deriveStarknetKeypair: (
    mnemonic: string,
    addressIndex: number,
    accountIndex: number,
    passphrase?: string,
  ) => Promise<StarkKeypair>;
  readonly generateMnemonic: (wordCount?: number) => Promise<string>;
  readonly getAccountClassHashes: () => Promise<string>;
  readonly signStarkHash: (privateKey: string, messageHash: string) => Promise<StarkSignature>;
  readonly validateMnemonic: (mnemonic: string) => Promise<boolean>;
};
