/**
 * Structural checks on the QSB binding transaction `T`: the Bitcoin legacy
 * serialization of a proposed withdrawal with every scriptSig emptied and no
 * witness data, as the "QSB Wallet Secret Management" BIP (profile
 * QSB-HORS-v1) defines it.
 *
 * Pure and shape-only: this module parses bytes and never hashes them. It
 * proves that a stored `T` is one complete transaction of that form and that
 * exactly one of its inputs spends the recorded vault outpoint. It does not
 * prove that `T` is the transaction the user approved, that its digest `D`
 * matches, or that the funding outpoint exists on chain: those re-checks need
 * SHA-256 and the previous transactions, and belong to the background, which
 * runs them through Krusty before any preimage is released.
 */
import { bytesToHex, hexToBytes } from "@bramble/core/hex";

/** One input's previous outpoint, with the txid in conventional display order. */
type Outpoint = { readonly txid: string; readonly vout: number };

// Bitcoin's compact-size integer, canonical encodings only: a value that fits
// a shorter form must use it, as Bitcoin Core's own reader requires, so one
// transaction has exactly one accepted serialization.
const COMPACT_SIZE_FORMS: ReadonlyMap<number, { readonly bytes: number; readonly min: number }> =
  new Map([
    [0xfd, { bytes: 2, min: 0xfd }],
    [0xfe, { bytes: 4, min: 0x1_0000 }],
    [0xff, { bytes: 8, min: 0x1_0000_0000 }],
  ]);

class TransactionReader {
  private offset = 0;

  public constructor(private readonly bytes: Uint8Array) {}

  public get done(): boolean {
    return this.offset === this.bytes.length;
  }

  public take(length: number): Uint8Array | null {
    if (length > this.bytes.length - this.offset) {
      return null;
    }
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  // Little-endian unsigned integer of up to eight bytes; values past 2^53 are
  // returned inexactly, which only ever makes a bound check fail.
  public uint(length: number): number | null {
    const slice = this.take(length);
    return slice === null ? null : slice.reduceRight((total, byte) => total * 256 + byte, 0);
  }

  public compactSize(): number | null {
    const first = this.uint(1);
    const form = first === null ? undefined : COMPACT_SIZE_FORMS.get(first);
    if (first === null || form === undefined) {
      return first;
    }
    const value = this.uint(form.bytes);
    return value !== null && value >= form.min ? value : null;
  }
}

const readInput = (reader: TransactionReader): Outpoint | null => {
  const hash = reader.take(32);
  const vout = reader.uint(4);
  const scriptSigLength = reader.compactSize();
  const sequence = reader.take(4);
  // T carries no unlocking data: a non-empty scriptSig is not T.
  if (hash === null || vout === null || scriptSigLength !== 0 || sequence === null) {
    return null;
  }
  return { txid: bytesToHex(hash.slice().reverse()), vout };
};

const readOutput = (reader: TransactionReader): boolean => {
  const value = reader.take(8);
  const scriptLength = reader.compactSize();
  return value !== null && scriptLength !== null && reader.take(scriptLength) !== null;
};

// A count no larger than the bytes left could possibly hold, so a hostile
// count never drives the loop past the input.
const readCount = (reader: TransactionReader, remaining: number): number | null => {
  const count = reader.compactSize();
  return count !== null && count > 0 && count <= remaining ? count : null;
};

const readInputs = (reader: TransactionReader, length: number): Outpoint[] | null => {
  // An input count of zero is the segregated-witness marker byte: T has none.
  const count = readCount(reader, length);
  if (count === null) {
    return null;
  }
  const inputs: Outpoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const input = readInput(reader);
    if (input === null) {
      return null;
    }
    inputs.push(input);
  }
  return inputs;
};

const readOutputs = (reader: TransactionReader, length: number): boolean => {
  const count = readCount(reader, length);
  if (count === null) {
    return false;
  }
  for (let index = 0; index < count; index += 1) {
    if (!readOutput(reader)) {
      return false;
    }
  }
  return true;
};

/**
 * Parses `T` from lowercase hex and returns every input's previous outpoint in
 * order, or null unless the bytes are exactly one legacy transaction: version,
 * at least one input with an empty scriptSig, at least one output, locktime,
 * canonical compact sizes, no witness serialization, and no trailing bytes.
 * The caller bounds the hex length first; nothing here hashes or trusts `T`.
 */
export const qsbTransactionOutpoints = (transaction: string): readonly Outpoint[] | null => {
  const bytes = hexToBytes(transaction);
  if (bytes === null) {
    return null;
  }
  const reader = new TransactionReader(bytes);
  const version = reader.take(4);
  const inputs = version === null ? null : readInputs(reader, bytes.length);
  const complete =
    inputs !== null && readOutputs(reader, bytes.length) && reader.take(4) !== null && reader.done;
  return complete ? inputs : null;
};

/**
 * Checks the BIP rule that exactly one input of `T`, the vault input, spends
 * the recorded funding outpoint (`txid` in display order). False for a `T`
 * that does not parse, that spends the outpoint twice, or that never spends it.
 */
export const spendsOutpointOnce = (transaction: string, funding: Outpoint): boolean =>
  qsbTransactionOutpoints(transaction)?.filter(
    (input) => input.txid === funding.txid && input.vout === funding.vout,
  ).length === 1;
