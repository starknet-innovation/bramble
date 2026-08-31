/**
 * Deterministic ML-DSA-65 test material. A paired-phone account is verified
 * against a real lattice signature, so a stub signer would let a wrong one
 * through and prove nothing — these fixtures produce genuine keys and
 * signatures instead. Test-only: never a production dependency, and the secret
 * key here is a fixture seed, not wallet key material.
 *
 * The message encoding matches the wire contract exactly: the transaction hash
 * as 32 big-endian bytes with an empty FIPS 204 context. A fixture that encoded
 * it differently would produce signatures the host verifier rejects for the
 * wrong reason.
 */
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";

/**
 * One deterministic ML-DSA-65 identity: the enrolled public key as lowercase
 * hex, and a signer over any transaction hash.
 */
export type MlDsa65Fixture = {
  readonly publicKey: string;
  readonly sign: (messageHash: string, context?: Uint8Array) => string;
};

const FELT_BYTES = 32;

// The workspace architecture bars the testkit from depending on @mc-wallet/core,
// so this cannot reuse its `bytesToHex`. Test-only and two lines; a drifted copy
// here would show up immediately as a signature the host verifier rejects.
const toHex = (bytes: Uint8Array): string =>
  `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;

const messageOf = (messageHash: string): Uint8Array => {
  const digits = messageHash.replace(/^0x/, "").padStart(FELT_BYTES * 2, "0");
  const message = new Uint8Array(FELT_BYTES);
  for (let index = 0; index < FELT_BYTES; index += 1) {
    message[index] = Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16);
  }
  return message;
};

/**
 * A verifier with the shape the background injects, for tests that assert a
 * signer path fails closed.
 *
 * It has to be a real ML-DSA verification: the assertions around it are that an
 * impostor key, a signature over a different hash, and a domain-separated
 * signature are all rejected, and a stub that answered `false` for everything or
 * `true` for everything would make all three vacuous. Test-only, and the one
 * remaining reason `@noble/post-quantum` stays a testkit devDependency.
 */
export const mlDsa65Verify = async (
  publicKey: string,
  transactionHash: string,
  signature: string,
): Promise<boolean> => {
  const bytes = (value: string): Uint8Array | null => {
    const digits = value.replace(/^0x/, "");
    if (digits.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(digits)) {
      return null;
    }
    const out = new Uint8Array(digits.length / 2);
    for (let index = 0; index < out.length; index += 1) {
      out[index] = Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16);
    }
    return out;
  };
  const key = bytes(publicKey);
  const signatureBytes = bytes(signature);
  if (key === null || signatureBytes === null) {
    return false;
  }
  try {
    return ml_dsa65.verify(signatureBytes, messageOf(transactionHash), key);
  } catch {
    return false;
  }
};

/**
 * Builds a fixture from a single seed byte, so distinct seeds give distinct
 * identities and the same seed always gives the same one. Pass `context` to
 * `sign` to produce a domain-separated signature the empty-context host
 * verifier must reject.
 */
export const mlDsa65Fixture = (seed: number): MlDsa65Fixture => {
  const keys = ml_dsa65.keygen(new Uint8Array(32).fill(seed));
  return {
    publicKey: toHex(keys.publicKey),
    sign: (messageHash, context) =>
      toHex(
        ml_dsa65.sign(messageOf(messageHash), keys.secretKey, context ? { context } : undefined),
      ),
  };
};
