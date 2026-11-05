/**
 * The signed half of a QSB withdrawal, ported from qsb-app
 * `src/lib/transactions.ts` (`verifyWithdrawalCommitment`, `helperPsbt`,
 * `verifySignedPsbt`) and `src/lib/offline-signed-result.ts`
 * (`finalizeVerifiedOfflineHelper`).
 *
 * `finish` returns the transaction with input 1's QSB scriptSig in place and
 * input 0, the helper, unsigned. Its commitment to the approved intent is
 * checked first (the manifest's outpoints, sequences, output and fee, and
 * `T` once its scriptSigs are emptied). The helper PSBT then carries input
 * 0's full previous transaction and its owner P2WPKH `witnessUtxo` with
 * SIGHASH_ALL, and input 1's previous transaction; Krusty signs input 0 only.
 * What Krusty returns must leave the unsigned transaction, every
 * `witnessUtxo` and input 1's final scriptSig untouched and carry exactly one
 * SIGHASH_ALL partial sig under the owner's key, which is verified against the
 * BIP-143 digest before input 0 is finalized and the transaction extracted.
 *
 * btc-signer builds, parses, finalizes and extracts; it never signs, and a
 * test fails if any source calls its signing. Every check fails closed as
 * null. Pure.
 */
import { bytesToHex, hexToBytes } from "@bramble/core/hex";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { NETWORK, p2pkh, Transaction } from "@scure/btc-signer";
import { QSB_TRANSACTION_OPTIONS } from "../deposit/transactions";
import type { QsbSolution } from "./binding";
import type { QsbWithdrawalManifest } from "./manifest";

const SIGHASH_ALL = 1;
const HELPER_SEQUENCE = 0xffff_fffe;
// The coordinator's submit body takes at most 150,000 hex digits.
const MAX_SIGNED_BYTES = 75_000;

/** A finalized withdrawal: the bytes to submit and their txid. */
export type QsbSignedWithdrawal = {
  readonly rawTxHex: string;
  readonly txid: string;
};

type Input = ReturnType<Transaction["getInput"]>;

const sameBytes = (left: Uint8Array | undefined, right: Uint8Array | undefined): boolean =>
  left !== undefined && right !== undefined && bytesToHex(left) === bytesToHex(right);

const parseRaw = (rawHex: string): Transaction | null => {
  const bytes = hexToBytes(rawHex);
  try {
    return bytes === null ? null : Transaction.fromRaw(bytes, QSB_TRANSACTION_OPTIONS);
  } catch {
    return null;
  }
};

const spends = (input: Input, txid: string, vout: number, sequence: number): boolean =>
  input.txid !== undefined &&
  bytesToHex(input.txid) === txid &&
  input.index === vout &&
  input.sequence === sequence;

const paysManifest = (tx: Transaction, manifest: QsbWithdrawalManifest): boolean => {
  const output = tx.getOutput(0);
  const fee = BigInt(manifest.fee);
  return (
    output.script !== undefined &&
    bytesToHex(output.script) === manifest.outputScript &&
    output.amount === BigInt(manifest.outputValue) &&
    output.amount > 0n &&
    fee > 0n &&
    BigInt(manifest.helper.value) + BigInt(manifest.funding.value) - output.amount === fee
  );
};

/**
 * Whether `finish`'s raw transaction is the approved withdrawal: version 1,
 * the solution's locktime, the helper then the funding at their sequences,
 * the one output and fee the manifest names, input 1's QSB scriptSig present
 * and input 0's absent, and `T` exactly once every scriptSig is emptied.
 */
export const qsbWithdrawalCommits = (input: {
  readonly manifest: QsbWithdrawalManifest;
  readonly rawHex: string;
  readonly solution: QsbSolution;
  readonly transaction: string;
}): boolean => {
  const { manifest, solution } = input;
  const tx = parseRaw(input.rawHex);
  if (
    tx === null ||
    tx.version !== 1 ||
    tx.lockTime !== solution.locktime ||
    tx.inputsLength !== 2 ||
    tx.outputsLength !== 1
  ) {
    return false;
  }
  const [helper, vault] = [tx.getInput(0), tx.getInput(1)];
  return (
    spends(helper, manifest.helper.txid, manifest.helper.vout, HELPER_SEQUENCE) &&
    spends(vault, manifest.funding.txid, manifest.funding.vout, solution.sequence) &&
    paysManifest(tx, manifest) &&
    (helper.finalScriptSig === undefined || helper.finalScriptSig.length === 0) &&
    (vault.finalScriptSig?.length ?? 0) > 0 &&
    bytesToHex(tx.unsignedTx) === input.transaction
  );
};

/**
 * The PSBT Krusty signs: `finish`'s transaction with input 0's previous
 * transaction, owner `witnessUtxo` and SIGHASH_ALL, and input 1's previous
 * transaction. Null when the transaction or either previous transaction does
 * not parse.
 */
export const buildQsbHelperPsbt = (input: {
  readonly fundingPreviousTxHex: string;
  readonly helperPreviousTxHex: string;
  readonly helperSat: bigint;
  readonly ownerScript: Uint8Array;
  readonly rawHex: string;
}): Transaction | null => {
  const tx = parseRaw(input.rawHex);
  const helperPrevious = hexToBytes(input.helperPreviousTxHex);
  const fundingPrevious = hexToBytes(input.fundingPreviousTxHex);
  if (tx === null || helperPrevious === null || fundingPrevious === null) return null;
  try {
    tx.updateInput(
      0,
      {
        nonWitnessUtxo: helperPrevious,
        sighashType: SIGHASH_ALL,
        witnessUtxo: { amount: input.helperSat, script: input.ownerScript },
      },
      true,
    );
    tx.updateInput(1, { nonWitnessUtxo: fundingPrevious }, true);
    return tx;
  } catch {
    return null;
  }
};

const parsePsbt = (bytes: Uint8Array): Transaction | null => {
  try {
    return Transaction.fromPSBT(bytes, QSB_TRANSACTION_OPTIONS);
  } catch {
    return null;
  }
};

// Exactly one SIGHASH_ALL partial sig, by the owner's key, on an input
// whose previous output is unchanged and that is not finalized yet.
const isSignedHelper = (actual: Input, expected: Input, ownerPublicKey: string): boolean => {
  const partials = actual.partialSig ?? [];
  const [entry] = partials;
  return (
    actual.witnessUtxo !== undefined &&
    expected.witnessUtxo !== undefined &&
    actual.witnessUtxo.amount === expected.witnessUtxo.amount &&
    sameBytes(actual.witnessUtxo.script, expected.witnessUtxo.script) &&
    (actual.sighashType === undefined || actual.sighashType === SIGHASH_ALL) &&
    partials.length === 1 &&
    entry !== undefined &&
    bytesToHex(entry[0]) === ownerPublicKey &&
    entry[1].length >= 9 &&
    entry[1].at(-1) === SIGHASH_ALL &&
    actual.finalScriptWitness === undefined &&
    actual.finalScriptSig === undefined
  );
};

// The QSB input: its final scriptSig exactly as `finish` made it, no witness.
const isUntouchedVault = (actual: Input, expected: Input): boolean =>
  sameBytes(actual.finalScriptSig, expected.finalScriptSig) &&
  (actual.finalScriptWitness?.length ?? 0) === 0;

// The helper's DER sig verified against its BIP-143 SIGHASH_ALL digest.
const verifiesHelper = (expected: Transaction, der: Uint8Array, key: Uint8Array): boolean => {
  const amount = expected.getInput(0).witnessUtxo?.amount;
  if (amount === undefined) return false;
  try {
    return secp256k1.verify(
      der.slice(0, -1),
      expected.preimageWitnessV0(0, p2pkh(key, NETWORK).script, SIGHASH_ALL, amount),
      key,
      { format: "der", prehash: false },
    );
  } catch {
    return false;
  }
};

const finalizedHelper = (tx: Transaction, key: Uint8Array): Uint8Array | null => {
  const helper = tx.getInput(0);
  const witness = helper.finalScriptWitness;
  return (helper.finalScriptSig === undefined || helper.finalScriptSig.length === 0) &&
    witness?.length === 2 &&
    sameBytes(witness[1], key) &&
    witness[0] !== undefined
    ? witness[0]
    : null;
};

/**
 * Checks the PSBT Krusty returned against `expected`, verifies the helper's
 * sig, finalizes input 0 only (witness `[sig, owner key]`, empty
 * scriptSig) and extracts the transaction. Null on any difference, a
 * sig that does not verify, or a result past the coordinator's limit.
 */
export const finalizeQsbWithdrawal = (
  expected: Transaction,
  signed: Uint8Array,
  ownerPublicKey: string,
): QsbSignedWithdrawal | null => {
  const actual = parsePsbt(signed);
  const key = hexToBytes(ownerPublicKey);
  if (
    actual === null ||
    key === null ||
    !sameBytes(actual.unsignedTx, expected.unsignedTx) ||
    actual.inputsLength !== 2 ||
    !isSignedHelper(actual.getInput(0), expected.getInput(0), ownerPublicKey) ||
    !isUntouchedVault(actual.getInput(1), expected.getInput(1))
  ) {
    return null;
  }
  try {
    actual.finalizeIdx(0);
    const der = finalizedHelper(actual, key);
    if (
      der === null ||
      !verifiesHelper(expected, der, key) ||
      !isUntouchedVault(actual.getInput(1), expected.getInput(1))
    ) {
      return null;
    }
    const raw = actual.extract();
    return raw.length <= MAX_SIGNED_BYTES ? { rawTxHex: bytesToHex(raw), txid: actual.id } : null;
  } catch {
    return null;
  }
};
