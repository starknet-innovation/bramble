/**
 * The deposit transaction: built as a version-0 PSBT for Krusty to sign,
 * then checked, finalized and extracted, through the pinned
 * `@scure/btc-signer` (qsb-app `src/lib/transactions.ts` `fundingPsbt` and
 * `verifySignedPsbt`, and `sdk/client.ts` `submitDeposit`).
 *
 * Krusty alone signs. Nothing here calls btc-signer's signing or holds a key:
 * a test fails if any Bramble source does. What Krusty returns is trusted
 * only once its unsigned transaction is byte-identical to the one rebuilt
 * here, every input's `witnessUtxo` is unchanged, and every input carries
 * exactly one SIGHASH_ALL partial signature by the owner's own key. That
 * comparison is the only guard on the change output, since the coordinator
 * checks output 0 alone.
 *
 * Pure. Builders and checks return null for anything they refuse.
 */
import { bytesToHex, hexToBytes } from "@bramble/core/hex";
import { NETWORK, Transaction } from "@scure/btc-signer";
import { QSB_MAX_DEPOSIT_INPUTS } from "./coins";
import { parseQsbTransaction, QSB_TRANSACTION_OPTIONS } from "./transactions";

/** One owner output a deposit spends, with its whole previous transaction. */
export type QsbDepositInput = {
  readonly previousTxHex: string;
  readonly txid: string;
  readonly valueSat: number;
  readonly vout: number;
};

/** Everything a deposit transaction is built from. */
export type QsbDepositPlan = {
  readonly amountSat: number;
  readonly changeSat: number;
  readonly inputs: readonly QsbDepositInput[];
  readonly ownerAddress: string;
  readonly ownerScript: Uint8Array;
  readonly scriptHex: string;
};

/** A finalized deposit: its txid and the raw bytes that are sent, both lowercase hex. */
export type QsbSignedDeposit = {
  readonly rawTxHex: string;
  readonly txid: string;
};

// Every vault script qsb-app will fund is at least 100 and at most 10,000 bytes.
const MIN_SCRIPT_BYTES = 100;
const MAX_SCRIPT_BYTES = 10_000;
// The longest transaction the coordinator accepts: 150,000 hex characters.
const MAX_SIGNED_BYTES = 75_000;
// Every input waits on nothing but final confirmation (BIP-125 opt-out).
const SEQUENCE = 0xffff_fffe;
const SIGHASH_ALL = 1;

const sameBytes = (left: Uint8Array | undefined, right: Uint8Array | undefined): boolean =>
  left !== undefined && right !== undefined && bytesToHex(left) === bytesToHex(right);

const hasDistinctInputs = (inputs: readonly QsbDepositInput[]): boolean =>
  new Set(inputs.map((input) => `${input.txid}:${input.vout}`)).size === inputs.length;

// Whether each input's previous transaction is the one its txid names.
const isEachPreviousItsTxid = (inputs: readonly QsbDepositInput[]): boolean =>
  inputs.every((input) => parseQsbTransaction(input.previousTxHex)?.id === input.txid);

const buildDeposit = (plan: QsbDepositPlan, script: Uint8Array): Transaction => {
  const tx = new Transaction({ ...QSB_TRANSACTION_OPTIONS, version: 2 });
  for (const input of plan.inputs) {
    tx.addInput({
      index: input.vout,
      nonWitnessUtxo: hexToBytes(input.previousTxHex) ?? new Uint8Array(),
      sequence: SEQUENCE,
      txid: input.txid,
      witnessUtxo: { amount: BigInt(input.valueSat), script: plan.ownerScript },
    });
  }
  tx.addOutput({ amount: BigInt(plan.amountSat), script });
  if (plan.changeSat > 0) {
    tx.addOutputAddress(plan.ownerAddress, BigInt(plan.changeSat), NETWORK);
  }
  return tx;
};

/**
 * The unsigned deposit: one input per owner output, in selection order, and
 * output 0 paying `amountSat` to the bare vault script, then change back to
 * the owner when there is any. Version 2, lock time 0, no sighash type set.
 * Null for no or more than eight inputs, a repeated input, a previous
 * transaction that is not its txid, a script outside 100–10,000 bytes, or
 * amounts that do not leave a positive fee.
 */
export const buildQsbDepositPsbt = (plan: QsbDepositPlan): Transaction | null => {
  const script = hexToBytes(plan.scriptHex);
  const total = plan.inputs.reduce((sum, input) => sum + BigInt(input.valueSat), 0n);
  if (
    script === null ||
    script.length < MIN_SCRIPT_BYTES ||
    script.length > MAX_SCRIPT_BYTES ||
    plan.inputs.length === 0 ||
    plan.inputs.length > QSB_MAX_DEPOSIT_INPUTS ||
    !hasDistinctInputs(plan.inputs) ||
    !isEachPreviousItsTxid(plan.inputs) ||
    plan.amountSat <= 0 ||
    plan.changeSat < 0 ||
    total - BigInt(plan.amountSat) - BigInt(plan.changeSat) <= 0n
  ) {
    return null;
  }
  try {
    return buildDeposit(plan, script);
  } catch {
    return null;
  }
};

// Exactly one SIGHASH_ALL partial signature, by the owner's key; no sighash
// type other than ALL requested; nothing finalized yet.
const isOwnerSignedInput = (
  input: ReturnType<Transaction["getInput"]>,
  ownerPublicKey: string,
): boolean => {
  const partials = input.partialSig ?? [];
  const [entry] = partials;
  return (
    (input.sighashType === undefined || input.sighashType === SIGHASH_ALL) &&
    partials.length === 1 &&
    entry !== undefined &&
    bytesToHex(entry[0]) === ownerPublicKey &&
    entry[1].length >= 9 &&
    entry[1][entry[1].length - 1] === SIGHASH_ALL &&
    input.finalScriptWitness === undefined &&
    input.finalScriptSig === undefined
  );
};

const isUnchangedInput = (
  actual: ReturnType<Transaction["getInput"]>,
  expected: ReturnType<Transaction["getInput"]>,
): boolean =>
  actual.witnessUtxo !== undefined &&
  expected.witnessUtxo !== undefined &&
  actual.witnessUtxo.amount === expected.witnessUtxo.amount &&
  sameBytes(actual.witnessUtxo.script, expected.witnessUtxo.script);

const parsePsbt = (bytes: Uint8Array): Transaction | null => {
  try {
    return Transaction.fromPSBT(bytes, QSB_TRANSACTION_OPTIONS);
  } catch {
    return null;
  }
};

/**
 * Checks the PSBT Krusty returned against `expected` (the PSBT handed to it),
 * then finalizes each input with the witness `[signature, owner key]` and
 * extracts the transaction. Null when the unsigned transaction differs, an
 * input's `witnessUtxo` changed, an input lacks exactly one SIGHASH_ALL
 * signature by `ownerPublicKey`, finalization fails, or the result is longer
 * than the coordinator accepts.
 */
export const finalizeQsbDeposit = (
  expected: Transaction,
  signed: Uint8Array,
  ownerPublicKey: string,
): QsbSignedDeposit | null => {
  const actual = parsePsbt(signed);
  if (
    actual === null ||
    !sameBytes(actual.unsignedTx, expected.unsignedTx) ||
    actual.inputsLength !== expected.inputsLength
  ) {
    return null;
  }
  for (let index = 0; index < expected.inputsLength; index += 1) {
    const input = actual.getInput(index);
    if (
      !isUnchangedInput(input, expected.getInput(index)) ||
      !isOwnerSignedInput(input, ownerPublicKey)
    ) {
      return null;
    }
  }
  try {
    for (let index = 0; index < actual.inputsLength; index += 1) actual.finalizeIdx(index);
    const raw = actual.extract();
    return raw.length <= MAX_SIGNED_BYTES ? { rawTxHex: bytesToHex(raw), txid: actual.id } : null;
  } catch {
    return null;
  }
};
