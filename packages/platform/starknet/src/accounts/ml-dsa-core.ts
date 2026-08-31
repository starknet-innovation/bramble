/**
 * The ML-DSA-65 operations the wallet needs from the shared core, implemented
 * in TypeScript **as a placeholder for Rust**.
 *
 * This file is the seam. Everything the wallet asks of ML-DSA beyond length
 * checks is one of the four functions below, so moving the implementation into
 * krusty-kms means reimplementing this file's exports and leaving every caller
 * alone. That is the whole reason it is a file of its own rather than logic
 * spread across the paths that need it.
 *
 * Three of the four are blocked work made unblocked here: the packed key and
 * its commitment (which the enrollment screen otherwise has to ask a user to
 * paste from `account_tool.py`), and the 1830-felt transaction payload (without
 * which no ML-DSA account can send anything). The fourth, verification, moved
 * in from `../transactions/ml-dsa-verify` so that this file holds the entire
 * ML-DSA surface and its dependency: when krusty gains the module,
 * `@noble/post-quantum` leaves the wallet with it.
 *
 * These are synchronous, while every `KmsPort` method returns a promise. That
 * is deliberate and cheap to undo — both call sites are already async, so the
 * swap adds three `await`s and changes no control flow. Making pure local
 * arithmetic async today would only add noise.
 *
 * Everything here reads public material: a public key, a public signature, and
 * a transaction hash. There is no signing and no key derivation, which is what
 * makes a TypeScript implementation admissible under "Krusty owns wallet
 * crypto" — the same reasoning behind the Ledger verify gate.
 */

import { hexToBytes } from "@mc-wallet/core/hex";
import { isStarkFieldElement, paddedFelt } from "@mc-wallet/wallet-model/networks";
import { isMlDsa65PublicKey, isMlDsa65Signature } from "@mc-wallet/wallet-model/signing";
import { shake256 } from "@noble/hashes/sha3";
import { hash } from "starknet";
import {
  CT_BYTES,
  convolve,
  D_BITS,
  expandA,
  GAMMA1,
  intt,
  K_ROWS,
  L_COLS,
  ntt,
  packBytes,
  packCoeffs,
  packFields,
  Q,
  sampleInBall,
  unpackHints,
  unpackT1,
  unpackZ,
  unpackZSigned,
  useHint,
} from "./ml-dsa-math";

/**
 * Felts the packed verification key occupies: 768 A, 154 T, 3 tr.
 */
export const ML_DSA_KEY_FELTS = 925;

/**
 * Felts one transaction's signature occupies, including the packed key.
 */
export const ML_DSA_PAYLOAD_FELTS = 1830;

// Rejection bound on z: GAMMA1 - TAU * eta.
const Z_BOUND = GAMMA1 - 196;
// Offsets that make the M' and K' hint rows nonnegative before packing.
const OFFSET_M = 1n << 36n;
const OFFSET_K = 1n << 58n;
const Z_BYTES = 640;
// Twenty-bit z fields on the wire: 256 per polynomial plus four of padding.
const Z_WIRE_FIELDS = 5 * 256 + 4;
// Bytes of hint bitfield: OMEGA positions then one cumulative count per row.
const HINT_BYTES = 61;

const filled = (count: number, value: bigint): bigint[] => Array<bigint>(count).fill(value);

type KeyMaterial = {
  readonly aCoefficients: number[][][];
  readonly tRows: number[][];
  readonly tr: Uint8Array;
};

// A = InvNTT(ExpandA(rho)), T = t1 * 2^d, tr = H(pk, 64). This is an expansion,
// not a decoding: A is 7680 coefficients pseudorandomly derived from 32 bytes of
// rho, which is why no amount of reading the public key produces it.
const keyMaterial = (publicKey: Uint8Array): KeyMaterial => ({
  aCoefficients: expandA(publicKey.subarray(0, 32)).map((row) => row.map(intt)),
  tRows: Array.from({ length: K_ROWS }, (_, i) =>
    unpackT1(publicKey.subarray(32 + 320 * i, 32 + 320 * (i + 1))).map((v) => v * (1 << D_BITS)),
  ),
  tr: shake256(publicKey, { dkLen: 64 }),
});

const packedKeyFelts = (material: KeyMaterial): bigint[] => [
  ...packCoeffs(material.aCoefficients.flat(2).map(BigInt)),
  ...packCoeffs(material.tRows.flat().map(BigInt)),
  ...packBytes(material.tr),
];

const toFelt = (value: bigint): string => `0x${value.toString(16)}`;

const publicKeyBytes = (publicKey: string): Uint8Array => {
  if (!isMlDsa65PublicKey(publicKey)) {
    throw new Error("Invalid ML-DSA-65 public key");
  }
  const bytes = hexToBytes(publicKey);
  if (bytes === null) {
    throw new Error("Invalid ML-DSA-65 public key");
  }
  return bytes;
};

/**
 * The 925-felt packed verification key: the argument the account contract
 * re-hashes on chain, and the prefix every transaction signature carries.
 */
export const mlDsaPackedKey = (publicKey: string): readonly string[] => {
  const felts = packedKeyFelts(keyMaterial(publicKeyBytes(publicKey))).map(toFelt);
  if (felts.length !== ML_DSA_KEY_FELTS) {
    throw new Error("ML-DSA packed key has the wrong length");
  }
  return felts;
};

/**
 * The Poseidon commitment to the packed key — `key_hash`, the account
 * contract's entire constructor and therefore half of its address preimage.
 */
export const mlDsaKeyCommitment = (publicKey: string): string =>
  hash.computePoseidonHashOnElements([...mlDsaPackedKey(publicKey)]);

const messageBytes = (transactionHash: string): Uint8Array | null => {
  if (!isStarkFieldElement(transactionHash)) {
    return null;
  }
  // The fixed 32-byte encoding, never the minimal spelling: a shorter message is
  // a different message to the verifier.
  const padded = paddedFelt(transactionHash);
  return padded === null ? null : hexToBytes(padded);
};

type VerifyResult = { readonly ok: boolean; readonly wRows: number[][] };

// FIPS 204 Algorithm 8, following `verify()` in the contract repository's
// `py/gen_vectors.py`. The `w` rows it computes on the way are exactly what the
// on-chain hints commit to, so the payload builder reuses this rather than
// recomputing them and risking a different answer.
const verifyInternal = (
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): VerifyResult => {
  const empty: VerifyResult = { ok: false, wRows: [] };
  const hints = unpackHints(signature.subarray(CT_BYTES + Z_BYTES * L_COLS));
  if (hints === null) {
    return empty;
  }
  const zHat: number[][] = [];
  for (let j = 0; j < L_COLS; j += 1) {
    const start = CT_BYTES + Z_BYTES * j;
    const { coefficients, maxAbs } = unpackZ(signature.subarray(start, start + Z_BYTES));
    if (maxAbs >= Z_BOUND) {
      return empty;
    }
    zHat.push(ntt(coefficients));
  }
  const tr = shake256(publicKey, { dkLen: 64 });
  const mu = shake256(concat(tr, new Uint8Array([0, 0]), message), { dkLen: 64 });
  const cHat = ntt(sampleInBall(signature.subarray(0, CT_BYTES)));
  const aHat = expandA(publicKey.subarray(0, 32));
  const wRows: number[][] = [];
  const w1Bytes = new Uint8Array(K_ROWS * 128);
  for (let i = 0; i < K_ROWS; i += 1) {
    const t1Hat = ntt(
      unpackT1(publicKey.subarray(32 + 320 * i, 32 + 320 * (i + 1))).map((v) => v * (1 << D_BITS)),
    );
    const row = aHat[i] as number[][];
    const w = new Array<number>(256);
    for (let t = 0; t < 256; t += 1) {
      let accumulator = 0;
      for (let j = 0; j < L_COLS; j += 1) {
        accumulator += ((row[j] as number[])[t] as number) * ((zHat[j] as number[])[t] as number);
      }
      w[t] = (accumulator + Q * Q - (cHat[t] as number) * (t1Hat[t] as number)) % Q;
    }
    const wRow = intt(w);
    wRows.push(wRow);
    const positions = new Set(hints[i]);
    for (let g = 0; g < 128; g += 1) {
      w1Bytes[i * 128 + g] =
        useHint(positions.has(2 * g), wRow[2 * g] as number) +
        16 * useHint(positions.has(2 * g + 1), wRow[2 * g + 1] as number);
    }
  }
  const expected = shake256(concat(mu, w1Bytes), { dkLen: CT_BYTES });
  return { ok: equalBytes(expected, signature.subarray(0, CT_BYTES)), wRows };
};

const concat = (...parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

// Length-checked, not constant-time: both operands are public, and the result
// gates a broadcast rather than a secret.
const equalBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

/**
 * Verifies an ML-DSA-65 signature over `hash` under `publicKey`. Malformed
 * lengths, non-canonical hex, and any internal error return false rather than
 * throwing, so a caller gating a broadcast gets one decision it can trust.
 */
export const verifyMlDsa65Signature = (input: {
  readonly hash: string;
  readonly publicKey: string;
  readonly signature: string;
}): boolean => {
  const { hash: transactionHash, publicKey, signature } = input;
  if (!isMlDsa65PublicKey(publicKey) || !isMlDsa65Signature(signature)) {
    return false;
  }
  const message = messageBytes(transactionHash);
  const keyBytes = hexToBytes(publicKey);
  const signatureBytes = hexToBytes(signature);
  if (message === null || keyBytes === null || signatureBytes === null) {
    return false;
  }
  try {
    return verifyInternal(keyBytes, message, signatureBytes).ok;
  } catch {
    return false;
  }
};

/**
 * A well-formed ML-DSA signature that verifies against nothing, for fee
 * estimation.
 *
 * The account contract runs its full verifier under a query version and then
 * tolerates the failing verdict, so an estimate taken this way includes the real
 * cost of validation without asking the phone for anything. What "well-formed"
 * has to mean is set by the three places the contract's verifier gives up before
 * doing that work, and each field below is chosen to clear one of them: the hint
 * bytes decode as six empty rows, every z field is GAMMA1 so the centred
 * coefficients are zero and inside the rejection bound, and the w coefficients
 * are zero and so below Q. A malformed dummy is *also* tolerated but exits
 * early, which yields a uselessly low estimate rather than an error.
 *
 * The packed key is the real one even though the contract now tolerates a wrong
 * one: it costs an expansion the wallet already knows how to do, it keeps the
 * measured path identical to a real transaction's, and it means this still works
 * against a class built before that tolerance existed.
 */
export const mlDsaEstimationSignature = (publicKey: string): readonly string[] => {
  const felts = [
    ...mlDsaPackedKey(publicKey),
    ...packBytes(new Uint8Array(CT_BYTES)).map(toFelt),
    ...packFields(filled(Z_WIRE_FIELDS, BigInt(GAMMA1)), 20, 6).map(toFelt),
    ...packBytes(new Uint8Array(HINT_BYTES)).map(toFelt),
    ...packCoeffs(filled(K_ROWS * 256, 0n)).map(toFelt),
    ...packFields(filled(K_ROWS * 256, OFFSET_M), 37, 3).map(toFelt),
    ...packFields(filled(K_ROWS * 256, OFFSET_K), 59, 2).map(toFelt),
  ];
  if (felts.length !== ML_DSA_PAYLOAD_FELTS) {
    throw new Error("ML-DSA estimation signature has the wrong length");
  }
  return felts;
};

// The Schwartz-Zippel hints. The contract checks an integer identity that the
// felt-domain evaluation alone cannot: for each row, A.z - c.t recomposes
// exactly as w + Q*M' + (x^256 + 1)*K'. Those two correction rows are what the
// signer supplies and the contract verifies, and they only exist as unreduced
// integers — hence bigint throughout.
const hintRows = (
  material: KeyMaterial,
  signature: Uint8Array,
  wRows: readonly number[][],
): { readonly m: bigint[]; readonly k: bigint[] } => {
  const aBig = material.aCoefficients.map((row) => row.map((poly) => poly.map(BigInt)));
  const tBig = material.tRows.map((row) => row.map(BigInt));
  const zRows = Array.from({ length: L_COLS }, (_, j) =>
    unpackZSigned(signature.subarray(CT_BYTES + Z_BYTES * j, CT_BYTES + Z_BYTES * (j + 1))).map(
      BigInt,
    ),
  );
  const cPoly = sampleInBall(signature.subarray(0, CT_BYTES)).map(BigInt);
  const m: bigint[] = [];
  const k: bigint[] = [];
  const bigQ = BigInt(Q);
  for (let i = 0; i < K_ROWS; i += 1) {
    const u = new Array<bigint>(511).fill(0n);
    for (let j = 0; j < L_COLS; j += 1) {
      const product = convolve((aBig[i] as bigint[][])[j] as bigint[], zRows[j] as bigint[]);
      for (let t = 0; t < 511; t += 1) {
        u[t] = (u[t] as bigint) + (product[t] as bigint);
      }
    }
    const challenge = convolve(cPoly, tBig[i] as bigint[]);
    for (let t = 0; t < 511; t += 1) {
      u[t] = (u[t] as bigint) - (challenge[t] as bigint);
    }
    const kRow = Array.from({ length: 256 }, (_, t) => (t < 255 ? (u[t + 256] as bigint) : 0n));
    const wRow = wRows[i] as number[];
    const mRow = Array.from({ length: 256 }, (_, t) => {
      const low = (u[t] as bigint) - (kRow[t] as bigint) - BigInt(wRow[t] as number);
      if (low % bigQ !== 0n) {
        throw new Error("ML-DSA hint recomposition is not divisible by Q");
      }
      return low / bigQ;
    });
    assertRecomposition(u, wRow, mRow, kRow, bigQ);
    m.push(...mRow.map((v) => v + OFFSET_M));
    k.push(...kRow.map((v) => v + OFFSET_K));
  }
  return { k, m };
};

// The hint rows are packed into fixed-width fields, so a value past its offset
// would wrap into its neighbour and be rejected on chain with no diagnosis.
const assertHintRange = (row: readonly bigint[], offset: bigint, name: string): void => {
  for (const value of row) {
    if (value >= offset || -value >= offset) {
      throw new Error(`ML-DSA ${name} hint out of range`);
    }
  }
};

// The contract rejects a wrong payload with no useful error, so the identity it
// checks is checked here first, exactly, before anything is emitted.
const assertRecomposition = (
  u: readonly bigint[],
  wRow: readonly number[],
  mRow: readonly bigint[],
  kRow: readonly bigint[],
  bigQ: bigint,
): void => {
  const recomposed = new Array<bigint>(511).fill(0n);
  for (let t = 0; t < 256; t += 1) {
    recomposed[t] = BigInt(wRow[t] as number) + bigQ * (mRow[t] as bigint) + (kRow[t] as bigint);
  }
  for (let t = 0; t < 255; t += 1) {
    recomposed[t + 256] = (recomposed[t + 256] as bigint) + (kRow[t] as bigint);
  }
  for (let t = 0; t < 511; t += 1) {
    if (recomposed[t] !== u[t]) {
      throw new Error("ML-DSA hint recomposition does not reproduce the integer identity");
    }
  }
  assertHintRange(mRow, OFFSET_M, "M");
  assertHintRange(kRow, OFFSET_K, "K");
};

// c_tilde as packed bytes, z as its raw twenty-bit wire fields padded to a whole
// felt with GAMMA1, then the hint bytes. 111 felts.
const signatureFelts = (signature: Uint8Array): bigint[] => {
  const zRaw: bigint[] = [];
  for (let j = 0; j < L_COLS; j += 1) {
    const bytes = signature.subarray(CT_BYTES + Z_BYTES * j, CT_BYTES + Z_BYTES * (j + 1));
    for (let g = 0; g < 128; g += 1) {
      let value = 0;
      for (let index = 4; index >= 0; index -= 1) {
        value = value * 256 + (bytes[5 * g + index] as number);
      }
      zRaw.push(BigInt(value % (1 << 20)), BigInt(Math.floor(value / (1 << 20))));
    }
  }
  return [
    ...packBytes(signature.subarray(0, CT_BYTES)),
    ...packFields([...zRaw, ...Array<bigint>(4).fill(BigInt(GAMMA1))], 20, 6),
    ...packBytes(signature.subarray(CT_BYTES + Z_BYTES * L_COLS)),
  ];
};

/**
 * The full 1830-felt transaction signature: the packed key, then the felt-native
 * signature and its verification hints. Throws rather than returning a payload
 * it could not prove the identity for, because the contract's rejection of a
 * wrong one carries no diagnosis.
 */
export const mlDsaSignaturePayload = (input: {
  readonly hash: string;
  readonly publicKey: string;
  readonly signature: string;
}): readonly string[] => {
  const { hash: transactionHash, publicKey, signature } = input;
  if (!isMlDsa65Signature(signature)) {
    throw new Error("Invalid ML-DSA-65 signature");
  }
  const keyBytes = publicKeyBytes(publicKey);
  const message = messageBytes(transactionHash);
  const signatureBytes = hexToBytes(signature);
  if (message === null || signatureBytes === null) {
    throw new Error("Invalid ML-DSA-65 transaction hash");
  }
  const { ok, wRows } = verifyInternal(keyBytes, message, signatureBytes);
  if (!ok) {
    throw new Error("ML-DSA-65 signature does not verify under this key");
  }
  const material = keyMaterial(keyBytes);
  const { k, m } = hintRows(material, signatureBytes, wRows);
  const payload = [
    ...packedKeyFelts(material),
    ...signatureFelts(signatureBytes),
    ...packCoeffs(wRows.flat().map(BigInt)),
    ...packFields(m, 37, 3),
    ...packFields(k, 59, 2),
  ];
  if (payload.length !== ML_DSA_PAYLOAD_FELTS) {
    throw new Error("ML-DSA payload has the wrong length");
  }
  return payload.map(toFelt);
};
