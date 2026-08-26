/**
 * Host-side ML-DSA-65 verification of a paired device's response against the
 * account's enrolled public key. This is a public-key operation: it never signs,
 * derives, or reads any secret, so it does not weaken "Krusty owns wallet
 * crypto" — the same reasoning that already lets the Ledger gate verify with
 * starknet.js rather than Krusty.
 *
 * The verified message is the transaction hash as 32 big-endian bytes, with an
 * empty FIPS 204 context. Both sides must agree exactly: a context mismatch
 * fails every check with no useful error, and a v3 invoke hash already commits
 * to the chain id, so separation would be redundant.
 */
import { hexToBytes } from "@mc-wallet/core/hex";
import { isStarkFieldElement, paddedFelt } from "@mc-wallet/wallet-model/networks";
import { isMlDsa65PublicKey, isMlDsa65Signature } from "@mc-wallet/wallet-model/signing";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";

/**
 * Verifies an ML-DSA-65 signature over `hash` under `publicKey`. Malformed
 * lengths, non-canonical hex, and any library error return false rather than
 * throwing, so a caller gating a broadcast gets one decision it can trust.
 */
export const verifyMlDsa65Signature = (input: {
  readonly hash: string;
  readonly publicKey: string;
  readonly signature: string;
}): boolean => {
  const { hash, publicKey, signature } = input;
  if (
    typeof hash !== "string" ||
    !isStarkFieldElement(hash) ||
    !isMlDsa65PublicKey(publicKey) ||
    !isMlDsa65Signature(signature)
  ) {
    return false;
  }
  // The message is the fixed 32-byte encoding of the hash, never its minimal
  // spelling: a shorter message is a different message to the verifier.
  const padded = paddedFelt(hash);
  const message = padded === null ? null : hexToBytes(padded);
  const publicKeyBytes = hexToBytes(publicKey);
  const signatureBytes = hexToBytes(signature);
  if (message === null || publicKeyBytes === null || signatureBytes === null) {
    return false;
  }
  try {
    return ml_dsa65.verify(signatureBytes, message, publicKeyBytes);
  } catch {
    return false;
  }
};
