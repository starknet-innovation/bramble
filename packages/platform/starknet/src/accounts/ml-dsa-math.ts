/**
 * FIPS 204 (ML-DSA-65) arithmetic and the felt packing the Cairo account
 * expects. **This file is a placeholder for Rust.** It exists so the wallet can
 * be developed end to end before the shared core has an ML-DSA module; every
 * function here mirrors one in `py/gen_vectors.py` in the contract repository,
 * which is the reference the Cairo verifier was written against, and is named
 * after it so the two can be diffed by eye.
 *
 * Nothing here is secret-dependent. Inputs are a public key, a public
 * signature, and a transaction hash; there is no signing, no key derivation,
 * and no source of randomness. That is what makes a TypeScript implementation
 * admissible at all under "Krusty owns wallet crypto" — the same reasoning
 * already applied to the Ledger verify gate.
 *
 * Number types are load-bearing. Everything modulo Q stays in `number`: a
 * product of two values under Q is under 2^46, well inside exact integer range.
 * The Schwartz-Zippel hint machinery does **not** — it needs the unreduced
 * integer convolution, whose accumulators pass 2^52 and would silently lose
 * precision — so that path is `bigint` throughout.
 */

import { shake128, shake256 } from "@noble/hashes/sha3";

/**
 * The ML-DSA modulus, 2^23 - 2^13 + 1.
 */
export const Q = 8380417;

/**
 * Rows of the public matrix A, and of t1.
 */
export const K_ROWS = 6;

/**
 * Columns of A, and the number of z polynomials.
 */
export const L_COLS = 5;

/**
 * Dropped low-order bits of t.
 */
export const D_BITS = 13;

/** Nonzero coefficients in the challenge polynomial. */
const TAU = 49;

/**
 * Coefficient range of z before the challenge is subtracted.
 */
export const GAMMA1 = 1 << 19;

// The twenty-bit wire field z is packed into, GAMMA1 * 2.
const GAMMA1_FIELD = 1 << 20;

/** Low-order rounding range, (Q - 1) / 32. */
const GAMMA2 = (Q - 1) / 32;

/**
 * Bytes of c_tilde at this parameter set, lambda / 4.
 */
export const CT_BYTES = 48;

/** Maximum total hint positions across all rows. */
const OMEGA = 55;

const modPow = (base: number, exponent: number, modulus: number): number => {
  let result = 1;
  let b = base % modulus;
  let e = exponent;
  while (e > 0) {
    if (e % 2 === 1) {
      result = (result * b) % modulus;
    }
    b = (b * b) % modulus;
    e = Math.floor(e / 2);
  }
  return result;
};

const bitrev8 = (value: number): number => {
  let out = 0;
  for (let bit = 0; bit < 8; bit += 1) {
    out = out * 2 + ((value >> bit) & 1);
  }
  return out;
};

// ZETAS[i] = 1753^bitrev8(i) mod Q, plain (non-Montgomery) domain, matching
// `mldsa/src/tables.cairo`.
const ZETAS = Array.from({ length: 256 }, (_, index) => modPow(1753, bitrev8(index), Q));
const INV256 = modPow(256, Q - 2, Q);

/**
 * Forward number-theoretic transform, in place on a copy.
 */
export const ntt = (input: readonly number[]): number[] => {
  const a = [...input];
  let k = 0;
  for (let length = 128; length >= 1; length = Math.floor(length / 2)) {
    for (let start = 0; start < 256; start += 2 * length) {
      k += 1;
      const zeta = ZETAS[k] as number;
      for (let j = start; j < start + length; j += 1) {
        const t = (zeta * (a[j + length] as number)) % Q;
        a[j + length] = ((a[j] as number) - t + Q) % Q;
        a[j] = ((a[j] as number) + t) % Q;
      }
    }
  }
  return a;
};

/**
 * Inverse number-theoretic transform, including the 1/256 factor.
 */
export const intt = (input: readonly number[]): number[] => {
  const a = [...input];
  let k = 256;
  for (let length = 1; length < 256; length *= 2) {
    for (let start = 0; start < 256; start += 2 * length) {
      k -= 1;
      const zeta = Q - (ZETAS[k] as number);
      for (let j = start; j < start + length; j += 1) {
        const t = a[j] as number;
        a[j] = (t + (a[j + length] as number)) % Q;
        a[j + length] = (zeta * (t - (a[j + length] as number) + Q)) % Q;
      }
    }
  }
  return a.map((x) => (x * INV256) % Q);
};

// Rejection-samples one polynomial of A from a 34-byte seed. The 840-byte
// SHAKE-128 read is five blocks, which succeeds with overwhelming probability;
// a short read would be a silent divergence from the contract, so it throws.
const rejNttPoly = (seed: Uint8Array): number[] => {
  const stream = shake128(seed, { dkLen: 840 });
  const out: number[] = [];
  let pos = 0;
  while (out.length < 256) {
    if (pos + 3 > stream.length) {
      throw new Error("ML-DSA rejection sampling exhausted its SHAKE-128 stream");
    }
    const value =
      (stream[pos] as number) +
      256 * (stream[pos + 1] as number) +
      65536 * ((stream[pos + 2] as number) & 0x7f);
    pos += 3;
    if (value < Q) {
      out.push(value);
    }
  }
  return out;
};

/**
 * Expands rho into the K x L public matrix A, in the NTT domain.
 */
export const expandA = (rho: Uint8Array): number[][][] => {
  const seed = new Uint8Array(34);
  seed.set(rho.subarray(0, 32), 0);
  return Array.from({ length: K_ROWS }, (_, r) =>
    Array.from({ length: L_COLS }, (_, s) => {
      seed[32] = s;
      seed[33] = r;
      return rejNttPoly(seed);
    }),
  );
};

/**
 * Derives the challenge polynomial from c_tilde: TAU coefficients of +/-1.
 */
export const sampleInBall = (cTilde: Uint8Array): number[] => {
  const stream = shake256(cTilde, { dkLen: 272 });
  let signs = 0n;
  for (let byte = 7; byte >= 0; byte -= 1) {
    signs = (signs << 8n) | BigInt(stream[byte] as number);
  }
  let pos = 8;
  const c = new Array<number>(256).fill(0);
  for (let i = 256 - TAU; i < 256; i += 1) {
    let j = 0;
    for (;;) {
      j = stream[pos] as number;
      pos += 1;
      if (j <= i) {
        break;
      }
    }
    c[i] = c[j] as number;
    c[j] = (signs & 1n) === 0n ? 1 : Q - 1;
    signs >>= 1n;
  }
  return c;
};

// Reads a little-endian group of five bytes. Deliberately arithmetic rather
// than bitwise: the value runs to 40 bits, and JavaScript's `&`, `>>` and `|`
// would truncate it to 32 without any error.
const readFive = (bytes: Uint8Array, offset: number): number => {
  let value = 0;
  for (let index = 4; index >= 0; index -= 1) {
    value = value * 256 + (bytes[offset + index] as number);
  }
  return value;
};

/**
 * Unpacks one row of t1: 320 bytes of ten-bit fields into 256 coefficients.
 */
export const unpackT1 = (bytes: Uint8Array): number[] => {
  const out: number[] = [];
  for (let group = 0; group < 64; group += 1) {
    let value = readFive(bytes, 5 * group);
    for (let field = 0; field < 4; field += 1) {
      out.push(value % 1024);
      value = Math.floor(value / 1024);
    }
  }
  return out;
};

/**
 * Unpacks one z polynomial from its 640 bytes of twenty-bit fields, returning
 * the coefficients reduced mod Q and the largest absolute centered value, which
 * the caller checks against the rejection bound.
 */
export const unpackZ = (bytes: Uint8Array): { coefficients: number[]; maxAbs: number } => {
  const coefficients: number[] = [];
  let maxAbs = 0;
  for (let group = 0; group < 128; group += 1) {
    const value = readFive(bytes, 5 * group);
    const low = value % GAMMA1_FIELD;
    const high = Math.floor(value / GAMMA1_FIELD);
    for (const raw of [low, high]) {
      const centered = GAMMA1 - raw;
      maxAbs = Math.max(maxAbs, Math.abs(centered));
      coefficients.push(((centered % Q) + Q) % Q);
    }
  }
  return { coefficients, maxAbs };
};

/**
 * Unpacks one z polynomial as the signed integers the hint recomposition needs.
 * The Cairo verifier evaluates the raw wire fields and corrects by GAMMA1 * G,
 * so the hints must use this representation rather than the mod-Q one.
 */
export const unpackZSigned = (bytes: Uint8Array): number[] => {
  const out: number[] = [];
  for (let group = 0; group < 128; group += 1) {
    const value = readFive(bytes, 5 * group);
    out.push(GAMMA1 - (value % GAMMA1_FIELD), GAMMA1 - Math.floor(value / GAMMA1_FIELD));
  }
  return out;
};

/**
 * Unpacks the hint bitfield into one sorted position list per row, or null when
 * it is malformed. Every malformed shape here is a rejected signature rather
 * than an exception: this parses attacker-supplied bytes.
 */
export const unpackHints = (bytes: Uint8Array): number[][] | null => {
  const rows: number[][] = [];
  let index = 0;
  for (let row = 0; row < K_ROWS; row += 1) {
    const end = bytes[OMEGA + row] as number;
    if (end < index || end > OMEGA) {
      return null;
    }
    const positions = strictlyIncreasing(bytes, index, end);
    if (positions === null) {
      return null;
    }
    rows.push(positions);
    index = end;
  }
  return bytes.subarray(index, OMEGA).some((byte) => byte !== 0) ? null : rows;
};

// Positions within a row must be strictly increasing, which is what makes the
// encoding canonical: two spellings of one hint set would be two signatures the
// contract treats alike.
const strictlyIncreasing = (bytes: Uint8Array, from: number, to: number): number[] | null => {
  const positions: number[] = [];
  for (let index = from; index < to; index += 1) {
    if (index > from && (bytes[index] as number) <= (bytes[index - 1] as number)) {
      return null;
    }
    positions.push(bytes[index] as number);
  }
  return positions;
};

/**
 * Recovers the high bits of one coefficient given its hint bit.
 */
export const useHint = (hint: boolean, r: number): number => {
  const quotient = Math.floor(r / (2 * GAMMA2));
  const remainder = r % (2 * GAMMA2);
  let high: number;
  let positive: boolean;
  if (remainder <= GAMMA2) {
    high = quotient === 16 ? 0 : quotient;
    positive = remainder !== 0 && quotient !== 16;
  } else {
    high = quotient === 15 ? 0 : quotient + 1;
    positive = false;
  }
  if (!hint) {
    return high;
  }
  return positive ? (high + 1) % 16 : (high + 15) % 16;
};

/**
 * Exact integer convolution of two polynomials, unreduced. `bigint` because the
 * accumulator is what the hint recomposition proves an identity about, and it
 * runs past the exact range of a double.
 */
export const convolve = (a: readonly bigint[], b: readonly bigint[]): bigint[] => {
  const out = new Array<bigint>(511).fill(0n);
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i] as bigint;
    if (ai === 0n) {
      continue;
    }
    for (let j = 0; j < b.length; j += 1) {
      out[i + j] = (out[i + j] as bigint) + ai * (b[j] as bigint);
    }
  }
  return out;
};

/**
 * Packs coefficients ten to a felt: five 23-bit fields in each u128 half.
 */
export const packCoeffs = (coefficients: readonly bigint[]): bigint[] =>
  packHalves(coefficients, 23n, 5);

/**
 * Packs values `perHalf` to each u128 half of a felt, at `bits` each.
 */
export const packFields = (values: readonly bigint[], bits: number, perHalf: number): bigint[] =>
  packHalves(values, BigInt(bits), perHalf);

const packHalves = (values: readonly bigint[], bits: bigint, perHalf: number): bigint[] => {
  const perFelt = 2 * perHalf;
  const felts: bigint[] = [];
  for (let group = 0; group < values.length; group += perFelt) {
    let low = 0n;
    let high = 0n;
    for (let slot = 0; slot < perHalf; slot += 1) {
      low += (values[group + slot] ?? 0n) << (bits * BigInt(slot));
      high += (values[group + perHalf + slot] ?? 0n) << (bits * BigInt(slot));
    }
    felts.push(low + (high << 128n));
  }
  return felts;
};

/**
 * Packs bytes 31 to a felt: 16 little-endian in the low u128, 15 in the high.
 */
export const packBytes = (data: Uint8Array): bigint[] => {
  const felts: bigint[] = [];
  for (let group = 0; group < data.length; group += 31) {
    felts.push(littleEndian(data, group, 16) + (littleEndian(data, group + 16, 15) << 128n));
  }
  return felts;
};

const littleEndian = (data: Uint8Array, offset: number, length: number): bigint => {
  let value = 0n;
  for (let index = length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(data[offset + index] ?? 0);
  }
  return value;
};
