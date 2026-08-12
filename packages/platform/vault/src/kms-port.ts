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
  /**
   * Derives the counterfactual OZ account address for a public key.
   *
   * Omitting `salt` means **salt 0** — the value every account this wallet has
   * ever derived was created with — and implementations must pass it explicitly
   * rather than defer to whatever the underlying KMS would default to. A deployed
   * account's address is immutable, so this is a wallet invariant: an
   * implementation that inherits a library default silently re-derives every
   * existing account to an address that was never deployed.
   */
  readonly deriveOzAccountAddress: (
    publicKeyX: string,
    classHash: string,
    salt?: string,
  ) => Promise<string>;
  /**
   * Derives the STRK20 viewing key for one exact chain and pool.
   *
   * Named for the scope on purpose. The KMS also exposes an *unscoped*
   * `deriveStrk20ViewingKey` taking only a private key, and the two are one
   * argument apart in a language that silently ignores extra arguments — a port
   * member called `deriveStrk20ViewingKey` would invite a caller to bind to the
   * unscoped function and derive a key the pool does not recognize, with nothing
   * failing. Only the scoped derivation belongs in this wallet.
   */
  readonly deriveScopedStrk20ViewingKey: (
    privateKey: string,
    chainId: string,
    poolAddress: string,
  ) => Promise<string>;
  /**
   * Folds a device signature over {@link KmsPort.strk20ViewingKeyMessageHash}
   * into a viewing key. The second of the two stages
   * {@link deriveScopedStrk20ViewingKey} composes, exposed so a Ledger — which
   * never reveals its private key — can supply the signature itself and still
   * land on a key this derivation recognizes.
   *
   * `publicKey` and `messageHash` are the signature's own subject: the KMS
   * verifies `(r, s)` against them before folding, so a signature from another
   * key or over another scope cannot produce a key. That is a second gate behind
   * the caller's own verify, not a replacement for it.
   *
   * The result is secret material: it goes only to the encrypted vault, never to
   * messages, logs, preferences, or UI state.
   */
  readonly foldStrk20ViewingKey: (
    publicKey: string,
    messageHash: string,
    r: string,
    s: string,
  ) => Promise<string>;
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
