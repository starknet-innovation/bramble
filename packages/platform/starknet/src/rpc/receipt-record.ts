/**
 * Field reads from an untrusted Starknet transaction receipt, plain or wrapped
 * by starknet.js. Fee reads and the mainnet receipt checks share this so neither
 * grows its own copy of how a ReceiptTx is opened.
 */
import { isOwnDataProperty } from "@bramble/core/json";

/**
 * Returns `value[key]` when it is an own enumerable data property of an
 * object, otherwise undefined. A getter never runs, so a hostile receipt cannot
 * run code or answer differently on a second read.
 *
 * Receipt bodies need no unwrapping: starknet.js 10's `createTransactionReceipt`
 * (what `getTransactionReceipt` returns) spreads the body onto the `ReceiptTx`,
 * and `new ReceiptTx` copies it with `Object.assign`, both as own enumerable
 * fields. `new ReceiptTx` keeps them for an unknown `execution_status` too;
 * `createTransactionReceipt` drops the body in that case, so every read is
 * undefined and the caller drops it.
 */
export const ownField = (value: unknown, key: string): unknown => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return isOwnDataProperty(descriptor) ? descriptor.value : undefined;
};
