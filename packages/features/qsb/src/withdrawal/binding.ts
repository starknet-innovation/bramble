/**
 * The checks Bramble runs on a QSB withdrawal's `T` before any preimage is
 * released: the transaction rebuilt byte for byte from the persisted
 * manifest and the solution, the sequence and locktime ranges the
 * coordinator only checks at submit, the indices the solution discloses, and
 * the previous outputs both inputs spend.
 *
 * `T` is the BIP's legacy serialization with every scriptSig empty and no
 * witness (qsb-app `bridge.py` `prepare`, `qsb_pipeline.py` assemble):
 * version 1; input 0 the helper at sequence 0xfffffffe; input 1 the vault
 * funding at the solution's sequence; one output of `outputValue` to the
 * script Bramble derived from the destination; the solution's locktime.
 *
 * The naming trap: the solution's `round1`/`round2` are subsets of 9, while
 * the disclosure's `round0`/`round1` are HORS rounds. The pipeline sorts each
 * subset and signs with its first 8 and first 7 (`qsb_pipeline.py`), so
 * `round0 = sort(round1)[0..8]` and `round1 = sort(round2)[0..7]`.
 *
 * None of this verifies the QSB puzzle or that the indices authorize only
 * this `T` (the review says `binding: "unverified"`); the pinned pipeline's
 * own assembly in `prepare` is what ties them. Pure.
 */
import { bytesToHex, hexToBytes } from "@bramble/core/hex";
import { hasExactKeys } from "../coordinator/response-grammar";
import { parseQsbTransaction } from "../deposit/transactions";
import type { QsbWithdrawalManifest } from "./manifest";

/** A coordinator solution: sequence, locktime and two subsets of 9 indices. */
export type QsbSolution = {
  readonly locktime: number;
  readonly round1: readonly number[];
  readonly round2: readonly number[];
  readonly sequence: number;
};

/** The disclosure a solution makes: 8 round-0 and 7 round-1 indices, in signing order. */
export type QsbDisclosedIndices = {
  readonly round0: readonly number[];
  readonly round1: readonly number[];
};

/** The vault input's sequence range the coordinator accepts at submit. */
export const QSB_SEQUENCE_RANGE = { max: 0xffff_ffff, min: 0x8000_0000 } as const;

/** The locktime range (timestamps in the past) the coordinator accepts at submit. */
export const QSB_LOCKTIME_RANGE = { max: 1_744_599_999, min: 500_000_000 } as const;

/** The helper input's sequence: final but lock-time enabled. */
const HELPER_SEQUENCE = 0xffff_fffe;
const SUBSET_SIZE = 9;
const SECRETS_PER_ROUND = 150;

const isUint32 = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 0xffff_ffff;

const isSubset = (value: unknown): value is readonly number[] =>
  Array.isArray(value) &&
  value.length === SUBSET_SIZE &&
  value.every((index) => Number.isSafeInteger(index) && index >= 0 && index < SECRETS_PER_ROUND) &&
  new Set(value).size === SUBSET_SIZE;

/**
 * Parses a solution strictly (`coordinatorSolvedResultSchema.solution`):
 * exactly its four fields, 32-bit sequence and locktime, two subsets of 9
 * distinct indices below 150. Null otherwise.
 */
export const readQsbSolution = (value: unknown): QsbSolution | null =>
  hasExactKeys(value, ["locktime", "round1", "round2", "sequence"]) &&
  isUint32(value["sequence"]) &&
  isUint32(value["locktime"]) &&
  isSubset(value["round1"]) &&
  isSubset(value["round2"])
    ? {
        locktime: value["locktime"],
        round1: [...value["round1"]],
        round2: [...value["round2"]],
        sequence: value["sequence"],
      }
    : null;

/** The solution as JSON in the coordinator's key order: what `prepare` reads. */
export const qsbSolutionJson = (solution: QsbSolution): string =>
  JSON.stringify({
    sequence: solution.sequence,
    locktime: solution.locktime,
    round1: solution.round1,
    round2: solution.round2,
  });

/**
 * Whether the sequence and locktime are in the ranges the coordinator
 * enforces at submit: outside them a disclosed `T` could never be sent.
 */
export const isQsbSolutionInRange = (solution: QsbSolution): boolean =>
  solution.sequence >= QSB_SEQUENCE_RANGE.min &&
  solution.sequence <= QSB_SEQUENCE_RANGE.max &&
  solution.locktime >= QSB_LOCKTIME_RANGE.min &&
  solution.locktime <= QSB_LOCKTIME_RANGE.max;

/** The indices the solution discloses: each subset sorted, its first 8 and 7. */
export const qsbDisclosedIndices = (solution: QsbSolution): QsbDisclosedIndices => {
  const ascending = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b);
  return {
    round0: ascending(solution.round1).slice(0, 8),
    round1: ascending(solution.round2).slice(0, 7),
  };
};

/** Whether `actual` is exactly the disclosure `solution` makes, order included. */
export const isQsbDisclosureOf = (actual: QsbDisclosedIndices, solution: QsbSolution): boolean => {
  const expected = qsbDisclosedIndices(solution);
  return (
    actual.round0.join() === expected.round0.join() &&
    actual.round1.join() === expected.round1.join()
  );
};

const uint32le = (value: number): number[] => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 24) & 0xff,
];

const uint64le = (value: bigint): number[] =>
  Array.from({ length: 8 }, (_, index) => Number((value >> BigInt(index * 8)) & 0xffn));

const compactSize = (value: number): number[] =>
  value < 0xfd ? [value] : [0xfd, value & 0xff, (value >> 8) & 0xff];

const outpoint = (txid: string, vout: number): number[] => [
  ...(hexToBytes(txid) ?? new Uint8Array()).reverse(),
  ...uint32le(vout),
];

/**
 * `T` for the manifest and solution, as lowercase hex, or null when the
 * manifest's txids or script are not hex. Version 1, the helper then the
 * funding, one output, the solution's locktime; every scriptSig empty.
 */
export const qsbWithdrawalTransaction = (
  manifest: QsbWithdrawalManifest,
  solution: QsbSolution,
): string | null => {
  const script = hexToBytes(manifest.outputScript);
  if (script === null || hexToBytes(manifest.helper.txid) === null) return null;
  if (hexToBytes(manifest.funding.txid) === null) return null;
  return bytesToHex(
    Uint8Array.from([
      ...uint32le(1),
      2,
      ...outpoint(manifest.helper.txid, manifest.helper.vout),
      0,
      ...uint32le(HELPER_SEQUENCE),
      ...outpoint(manifest.funding.txid, manifest.funding.vout),
      0,
      ...uint32le(solution.sequence),
      1,
      ...uint64le(BigInt(manifest.outputValue)),
      ...compactSize(script.length),
      ...script,
      ...uint32le(solution.locktime),
    ]),
  );
};

/** What one previous output pays: its amount and script. */
export type QsbPreviousOutput = {
  readonly amountSat: bigint;
  readonly script: string;
};

/**
 * Output `vout` of the previous transaction `previousTxHex`, only if that
 * transaction hashes to `txid`. Null otherwise.
 */
export const qsbPreviousOutput = (
  previousTxHex: string,
  txid: string,
  vout: number,
): QsbPreviousOutput | null => {
  const tx = parseQsbTransaction(previousTxHex);
  if (tx === null || tx.id !== txid || vout >= tx.outputsLength) return null;
  const output = tx.getOutput(vout);
  return output.amount === undefined || output.script === undefined
    ? null
    : { amountSat: output.amount, script: bytesToHex(output.script) };
};
