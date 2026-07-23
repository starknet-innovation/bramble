/**
 * Host-side verification of a Ledger-produced Stark signature against the stored
 * account public key. This is the fail-closed gate the signing seam runs before
 * any transaction is broadcast: the device blind-signs a hash and returns
 * `(r, s)`, and this recomputes nothing but checks that `(r, s)` is a valid
 * signature of that exact hash under the account's `publicKeyX`. A mismatch means
 * the wrong device, a corrupted exchange, or a substituted hash, and the caller
 * must abort with nothing submitted.
 *
 * This is a pure public-key operation via starknet.js's Stark curve — it does
 * NOT sign, derive a key, or validate a mnemonic, so it does not weaken the
 * "Krusty owns wallet crypto / fail closed" rule (which governs signing and key
 * derivation). The account stores only the x-coordinate, so the full curve point
 * is reconstructed at both possible y-parities and the signature is accepted if
 * it verifies under either — the same x-only check Starknet accounts use
 * on-chain. Deterministic; no clock, randomness, or device I/O.
 */
import { ec } from "starknet";
import { isStarkFieldElement } from "./networks";

const { starkCurve } = ec;

// The two SEC1 compression prefixes for the two candidate y-parities of a point
// reconstructed from its x-coordinate.
const PARITY_PREFIXES = ["02", "03"] as const;

/**
 * A raw device signature: the `(r, s)` scalar pair the Ledger returns for a
 * blind-signed hash, as `0x`-prefixed field elements.
 */
export type DeviceSignature = {
  readonly r: string;
  readonly s: string;
};

const canonicalX = (publicKeyX: string): string => publicKeyX.replace(/^0x/, "").padStart(64, "0");

// Reconstructs the curve point at one y-parity and verifies there. Any parse or
// range error (x not on curve at this parity, r/s out of range) fails closed.
const verifiesAtParity = (
  publicKeyX: string,
  prefix: string,
  signature: InstanceType<typeof starkCurve.Signature>,
  hash: string,
): boolean => {
  try {
    const pubKey = starkCurve.ProjectivePoint.fromHex(`${prefix}${canonicalX(publicKeyX)}`).toHex(
      false,
    );
    return starkCurve.verify(signature, hash, pubKey);
  } catch {
    return false;
  }
};

/**
 * True when `(r, s)` is a valid Stark signature of `hash` under `publicKeyX`.
 * Fails closed (returns `false`) on any malformed input or curve error rather
 * than throwing, so the caller has a single boolean gate to abort on.
 */
export const verifyStarkSignature = (input: {
  readonly hash: string;
  readonly publicKeyX: string;
  readonly signature: DeviceSignature;
}): boolean => {
  const { hash, publicKeyX, signature } = input;
  if (![hash, publicKeyX, signature.r, signature.s].every(isStarkFieldElement)) {
    return false;
  }
  let parsed: InstanceType<typeof starkCurve.Signature>;
  try {
    parsed = new starkCurve.Signature(BigInt(signature.r), BigInt(signature.s));
  } catch {
    return false;
  }
  return PARITY_PREFIXES.some((prefix) => verifiesAtParity(publicKeyX, prefix, parsed, hash));
};
