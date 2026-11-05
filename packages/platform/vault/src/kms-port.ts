/**
 * Privileged cryptographic capability required by the encrypted vault.
 */
import type { StarkSignature } from "@bramble/wallet-model/signing";

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
 * X-only Stark key material from derivations whose backend cannot produce an
 * affine Y coordinate (Ready's ETH-seeded scheme). Vault flows only.
 */
export type StarkXOnlyKeypair = {
  readonly privateKey: string;
  readonly publicKeyX: string;
};

/**
 * The public commitments of one Quantum Safe Bitcoin vault (profile
 * QSB-HORS-v1): 150 round-0 then 150 round-1 HASH160 commitments, each 40
 * lowercase hex digits in index order, all distinct, and their 32-byte root
 * `R[v]`. Public: they lock the vault script, and none reveals a secret.
 */
export type QsbCommitments = {
  readonly root: string;
  readonly round0: readonly string[];
  readonly round1: readonly string[];
};

/**
 * The transaction binding of one QSB disclosure: `binding` is `B = SHA256(T)`
 * and `digest` is `D = SHA256("QSB-HORS-v1/reveal" || I || B)`, each 64
 * lowercase hex digits. Public: they name what was disclosed, not a secret.
 */
export type QsbRevealDigest = {
  readonly binding: string;
  readonly digest: string;
};

/**
 * A BIP-84 mainnet P2WPKH key: its lowercase `bc1q` address, its 33-byte
 * compressed public key and its private key, each as lowercase hex without a
 * prefix. The private key is secret: vault flows only, derived on demand and
 * never persisted or returned across a message.
 */
export type BitcoinP2wpkhKeypair = {
  readonly address: string;
  readonly privateKey: string;
  readonly publicKey: string;
};

/**
 * Minimum cryptographic capability required by the privileged vault. Concrete
 * implementations must validate every input and output and fail closed.
 */
export type KmsPort = {
  /**
   * BIP-84 `m/84'/0'/{accountIndex}'/{change}/{addressIndex}` of a phrase, on
   * Bitcoin mainnet. `change` is 0 or 1; both indices are below 2^31.
   */
  readonly deriveBitcoinP2wpkhKeypair: (
    mnemonic: string,
    accountIndex: number,
    change: number,
    addressIndex: number,
  ) => Promise<BitcoinP2wpkhKeypair>;
  /**
   * The QSB-HORS-v1 commitments of vault `vaultIndex` (below 2^31) of a
   * dedicated QSB phrase, in the Bitcoin mainnet namespace. Deriving them
   * allocates nothing; the disclosure journal does.
   */
  readonly deriveQsbCommitments: (mnemonic: string, vaultIndex: number) => Promise<QsbCommitments>;
  /**
   * A BIP-322 "simple" proof that `privateKey` holds the P2WPKH `address`,
   * over the UTF-8 bytes of `message`: the witness stack as plain base64,
   * without the `smp` prefix, which is the form the QSB coordinator's
   * verifier (bip322-js 4.0.0) reads. Proves control; authorizes no spend.
   */
  readonly signBip322SimpleUnprefixed: (
    privateKey: string,
    address: string,
    message: string,
  ) => Promise<string>;
  /**
   * Adds this key's SIGHASH_ALL partial signature to the listed inputs of a
   * version-0 PSBT and returns the PSBT; every other byte is unchanged and
   * nothing is finalized or broadcast. Each listed input must spend this
   * key's own P2WPKH output, proven by its full previous transaction.
   */
  readonly signBitcoinPsbtInputs: (
    privateKey: string,
    psbt: Uint8Array,
    inputIndices: readonly number[],
  ) => Promise<Uint8Array>;
  /**
   * The QSB disclosure digest of the withdrawal transaction `T` (the BIP's
   * empty-scriptSig, witness-free legacy serialization, lowercase hex) for 8
   * round-0 and 7 round-1 indices, in the order given. Krusty parses `T`
   * itself and never accepts a hash in its place. Reveals nothing.
   */
  readonly qsbRevealDigest: (
    transaction: string,
    round0: readonly number[],
    round1: readonly number[],
  ) => Promise<QsbRevealDigest>;
  /**
   * The 15 HORS preimages of vault `vaultIndex` of a dedicated QSB phrase
   * (mainnet namespace) at those indices: round 0's then round 1's, in the
   * order given, each 20 bytes of lowercase hex. Spending secrets: call only
   * once the disclosure is durably recorded as exposed, from the vault
   * service's one release method, and drop them as soon as they are used.
   */
  readonly revealQsbPreimages: (
    mnemonic: string,
    vaultIndex: number,
    round0: readonly number[],
    round1: readonly number[],
  ) => Promise<readonly string[]>;
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
  readonly deriveArgentLegacyKeypair: (
    mnemonic: string,
    addressIndex: number,
  ) => Promise<StarkXOnlyKeypair>;
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
