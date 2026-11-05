/**
 * Well-formed stand-ins for Krusty's six QSB and Bitcoin exports, as plain
 * objects the adapter reads by own data property, for the suites whose
 * module doubles must expose every export the adapter requires. The values
 * are the published BIP-84 vector and commitments whose root really binds
 * them; `overrides` replaces any export.
 */
import { createHash } from "node:crypto";

const hex = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

/** The published BIP-84 vector for `m/84'/0'/0'/0/0` of `abandon … about`. */
export const BIP84_VECTOR = {
  address: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
  path: "m/84'/0'/0'/0/0",
  private_key: "4604b4b710fe91f584fff084e1a9159fe4f8408fff380596a604948474ce4fa3",
  public_key: "0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c",
} as const;

/** 2 × 150 distinct commitments and the QSB-HORS-v1 root over them. */
export const commitmentsResult = (salt = "fixture") => {
  const round = (r: number): string[] =>
    Array.from({ length: 150 }, (_, index) => hex(`${salt} ${r} ${index}`).slice(0, 40));
  const round0 = round(0);
  const round1 = round(1);
  const root = hex(
    Buffer.concat([
      Buffer.from("QSB-HORS-v1/root"),
      ...[...round0, ...round1].map((commitment) => Buffer.from(commitment, "hex")),
    ]),
  );
  return { root, round0, round1 };
};

/** A BIP-322 witness of the right shape: a 72-byte item ending 0x01, then a key. */
export const BIP322_WITNESS = Buffer.concat([
  Buffer.from([2, 72, 0x30]),
  Buffer.alloc(70, 7),
  Buffer.from([0x01, 33]),
  Buffer.from(BIP84_VECTOR.public_key, "hex"),
]).toString("base64");

/** The smallest buffer that starts like a PSBT. */
export const PSBT_BYTES = Uint8Array.from([0x70, 0x73, 0x62, 0x74, 0xff, 0x01, 0x00]);

/** The QSB disclosure digest of `transaction` (hex) and the indices, as the BIP defines it. */
export const revealDigestResult = (
  transaction: string,
  round0: readonly number[],
  round1: readonly number[],
) => {
  const binding = createHash("sha256").update(Buffer.from(transaction, "hex")).digest();
  const indices = Buffer.from(
    [...round0, ...round1].flatMap((index) => [index >> 8, index & 0xff]),
  );
  return {
    binding: binding.toString("hex"),
    digest: hex(Buffer.concat([Buffer.from("QSB-HORS-v1/reveal"), indices, binding])),
  };
};

/** 15 real-shaped preimages for the indices, round 0's then round 1's. */
export const preimagesResult = (round0: readonly number[], round1: readonly number[]) => [
  ...round0.map((index) => hex(`preimage 0 ${index}`).slice(0, 40)),
  ...round1.map((index) => hex(`preimage 1 ${index}`).slice(0, 40)),
];

/** The six exports, each answering with the well-formed value above. */
export const bitcoinExports = (overrides: Record<string, unknown> = {}) => ({
  deriveBitcoinP2wpkhKeypair: () => ({ ...BIP84_VECTOR }),
  deriveQsbCommitments: () => commitmentsResult(),
  qsbRevealDigest: (transaction: string, round0: number[], round1: number[]) =>
    revealDigestResult(transaction, round0, round1),
  revealQsbPreimages: (_m: string, _net: number, _v: number, round0: number[], round1: number[]) =>
    preimagesResult(round0, round1),
  signBip322Simple: () => BIP322_WITNESS,
  signBitcoinPsbtInputs: (_key: string, psbt: string) => psbt,
  ...overrides,
});
