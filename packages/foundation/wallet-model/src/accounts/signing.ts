/**
 * Signature shapes returned at the account hash-signing seam. Public material
 * only — no private key or mnemonic ever reaches this module, and the narrowing
 * helper below fails closed rather than reshaping a signature a consumer cannot
 * serialize.
 */
import { WalletError } from "@mc-wallet/core/errors";
import { isHexBytes } from "../networks/networks";

/**
 * Stark-curve signature returned by an authorized software or hardware signer.
 */
export type StarkSignature = {
  readonly publicKey: string;
  readonly r: string;
  readonly s: string;
};

/**
 * Raw two-scalar signature returned by a hardware device.
 */
export type DeviceSignature = Pick<StarkSignature, "r" | "s">;

/**
 * Encoded ML-DSA-65 (FIPS 204) public-key length in bytes. Forced by the
 * platforms rather than chosen: Apple's `SecureEnclave.MLDSA65` and Android
 * Keystore's ML-DSA-65 are the smallest parameter set either offers. Single
 * source for every length check on a post-quantum key.
 */
export const ML_DSA_65_PUBLIC_KEY_BYTES = 1952;

/**
 * Checks whether a value is an encoded ML-DSA-65 public key in lowercase hex.
 * Shape only: a well-formed key is not a key the paired device can sign for, so
 * enrollment still has to verify a proof of possession before any funds move.
 */
export const isMlDsa65PublicKey = (value: unknown): value is string =>
  isHexBytes(value, ML_DSA_65_PUBLIC_KEY_BYTES);

/**
 * Encoded ML-DSA-65 (FIPS 204) signature length in bytes — roughly 107 felts of
 * calldata, against the Stark curve's two. Single source for every length check
 * on a post-quantum signature.
 */
export const ML_DSA_65_SIGNATURE_BYTES = 3309;

/**
 * Felts one ML-DSA-65 account signature occupies as Starknet calldata: the
 * 925-felt packed verification key, 111 for the signature itself, and 794 of
 * verification witnesses.
 *
 * A wire-format fact about the scheme rather than a wallet choice, which is why
 * it sits beside the byte counts above: the account contract reads exactly this
 * many felts and rejects any other length with no useful error.
 */
export const ML_DSA_65_CALLDATA_FELTS = 1830;

/**
 * Checks whether a value is an encoded ML-DSA-65 signature in lowercase hex.
 * Shape only: a well-formed signature is not a valid one, so the
 * verify-before-broadcast gate still has to check it against the enrolled key.
 */
export const isMlDsa65Signature = (value: unknown): value is string =>
  isHexBytes(value, ML_DSA_65_SIGNATURE_BYTES);

/**
 * ML-DSA-65 (FIPS 204) signature returned by a post-quantum mobile signer. Both
 * fields are hex over the raw encodings: `publicKey` is 1952 bytes and
 * `signature` is 3309 bytes over the transaction hash — roughly 107 felts of
 * calldata against the Stark curve's two, which is why the seam below is a
 * union rather than a widened {@link StarkSignature}.
 */
export type MlDsa65Signature = {
  readonly kind: "ml-dsa-65";
  readonly publicKey: string;
  readonly signature: string;
};

/**
 * What a signer hands back at the account hash-signing seam. Discriminated so
 * the compiler forces every consumer that serializes signature felts to declare
 * which schemes it handles; nothing that persists or serializes `(r, s)` changes
 * shape, because the Stark member keeps {@link StarkSignature} intact.
 */
export type AccountSignature = ({ readonly kind: "stark" } & StarkSignature) | MlDsa65Signature;

/**
 * Narrows an {@link AccountSignature} for a path whose account contract only
 * validates `(r, s)`. Throws `WalletError` on any other scheme, so an
 * unsupported signature aborts the submit rather than broadcasting calldata the
 * account cannot validate. Reads only public material.
 */
export const requireStarkSignature = (signature: AccountSignature): StarkSignature => {
  if (signature.kind !== "stark") {
    throw new WalletError(`Unsupported signature scheme: ${signature.kind}`);
  }
  return { publicKey: signature.publicKey, r: signature.r, s: signature.s };
};
