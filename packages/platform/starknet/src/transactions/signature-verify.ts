/**
 * Host-side Stark signature verification against an x-only account public key.
 * This is a public-key operation: it never signs or derives secret material.
 */
import { isStarkFieldElement } from "@bramble/wallet-model/networks";
import type { DeviceSignature } from "@bramble/wallet-model/signing";
import { ec } from "starknet";

const { starkCurve } = ec;
const PARITY_PREFIXES = ["02", "03"] as const;

const canonicalX = (publicKeyX: string): string => publicKeyX.replace(/^0x/, "").padStart(64, "0");

const verifiesAtParity = (
  publicKeyX: string,
  prefix: string,
  signature: InstanceType<typeof starkCurve.Signature>,
  hash: string,
): boolean => {
  try {
    const publicKey = starkCurve.ProjectivePoint.fromHex(
      `${prefix}${canonicalX(publicKeyX)}`,
    ).toHex(false);
    return starkCurve.verify(signature, hash, publicKey);
  } catch {
    return false;
  }
};

/**
 * Verifies `(r, s)` over `hash` under either curve point represented by the
 * x-only `publicKeyX`. Malformed values and curve errors return false.
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
