/**
 * Raw Bitcoin transaction checks a deposit rests on, through the pinned
 * `@scure/btc-signer`: the owner's P2WPKH script, that a previous
 * transaction is the one its txid names and pays the owner exactly what the
 * coordinator said, a signed transaction's vsize, and that a vault's funding
 * transaction pays the vault's script at output 0.
 *
 * Trust boundary: every transaction here comes from the coordinator and is
 * trusted only once its bytes hash to the txid in hand. Parsing never signs
 * and never reads a key. Pure; each check is total and answers false or
 * null rather than throwing.
 */
import { bytesToHex, hexToBytes } from "@bramble/core/hex";
import { Address, NETWORK, OutScript, p2wpkh, Transaction } from "@scure/btc-signer";

/**
 * btc-signer's parse options for coordinator transactions: a deposit's
 * output 0 is a bare QSB script, which btc-signer calls unknown.
 */
export const QSB_TRANSACTION_OPTIONS = {
  allowUnknownInputs: true,
  allowUnknownOutputs: true,
} as const;

/** The output script of a mainnet P2WPKH address, or null for any other address. */
export const ownerP2wpkhScript = (address: string): Uint8Array | null => {
  try {
    const decoded = Address(NETWORK).decode(address);
    return decoded.type === "wpkh" ? OutScript.encode(decoded) : null;
  } catch {
    return null;
  }
};

/** Whether `address` is the mainnet P2WPKH address of the compressed `publicKey`. */
export const isOwnerKey = (address: string, publicKey: string): boolean => {
  const key = hexToBytes(publicKey);
  try {
    return key !== null && key.length === 33 && p2wpkh(key, NETWORK).address === address;
  } catch {
    return false;
  }
};

/** A raw transaction's parse, or null when its bytes are not one. */
export const parseQsbTransaction = (rawHex: string): Transaction | null => {
  const bytes = hexToBytes(rawHex);
  try {
    return bytes === null ? null : Transaction.fromRaw(bytes, QSB_TRANSACTION_OPTIONS);
  } catch {
    return null;
  }
};

/** Whether output `vout` of `tx` pays exactly `script` with `valueSat`. */
const paysScript = (tx: Transaction, vout: number, script: string, valueSat: number): boolean => {
  if (vout >= tx.outputsLength) return false;
  const output = tx.getOutput(vout);
  return (
    output.amount === BigInt(valueSat) &&
    output.script !== undefined &&
    bytesToHex(output.script) === script
  );
};

/**
 * Whether `previousTxHex` is transaction `txid` and its output `vout` pays
 * the owner's `ownerScript` exactly `valueSat`: what a payment input must be
 * before it is spent.
 */
export const isOwnerPayment = (input: {
  readonly ownerScript: Uint8Array;
  readonly previousTxHex: string;
  readonly txid: string;
  readonly valueSat: number;
  readonly vout: number;
}): boolean => {
  const tx = parseQsbTransaction(input.previousTxHex);
  return (
    tx !== null &&
    tx.id === input.txid &&
    paysScript(tx, input.vout, bytesToHex(input.ownerScript), input.valueSat)
  );
};

/**
 * Whether `rawTxHex` is transaction `txid` and its output 0 pays the vault's
 * `scriptHex` exactly `valueSat`: what a funding record must be before the
 * journal keeps it.
 */
export const isVaultFunding = (input: {
  readonly rawTxHex: string;
  readonly scriptHex: string;
  readonly txid: string;
  readonly valueSat: number;
}): boolean => {
  const tx = parseQsbTransaction(input.rawTxHex);
  return tx !== null && tx.id === input.txid && paysScript(tx, 0, input.scriptHex, input.valueSat);
};

/** The vsize of a signed raw transaction: weight over four, rounded up; null if unparsable. */
export const qsbTransactionVsize = (rawTxHex: string): number | null => {
  const tx = parseQsbTransaction(rawTxHex);
  if (tx === null) return null;
  const weight = 3 * tx.toBytes(true, false).length + tx.toBytes(true, true).length;
  return Math.ceil(weight / 4);
};
