/**
 * The JSON body of a Starknet transaction receipt, plain or wrapped by
 * starknet.js. Fee reads and the mainnet receipt checks share this so neither
 * grows its own copy of how a ReceiptTx is opened.
 */
import { isRecord } from "@bramble/core/json";

// Not `isOwnDataProperty`: that helper also requires the field to be
// enumerable, and the `ReceiptTx` constructor defines `value` as
// non-enumerable. A getter's descriptor has no `value` field, which is the
// check that stops untrusted input from running code.
const dataProperty = (value: object, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
};

/**
 * Returns the JSON-RPC receipt body, or undefined when `receipt` is not one.
 *
 * A plain record is returned unchanged. starknet.js 10's
 * `getTransactionReceipt` returns a `ReceiptTx` whose prototype is not
 * `Object.prototype`, so {@link isRecord} refuses it; the node body sits on
 * the own data property `value`. Only that data property is read, so a getter
 * cannot supply the body. `value` may be non-enumerable: the provider result
 * leaves it enumerable and `new ReceiptTx` hides it. A missing or non-record
 * `value`, or a non-object, is undefined and the caller drops the read.
 */
export const receiptRecord = (receipt: unknown): Record<string, unknown> | undefined => {
  if (isRecord(receipt)) {
    return receipt;
  }
  if (typeof receipt !== "object" || receipt === null) {
    return undefined;
  }
  const body = dataProperty(receipt, "value");
  return isRecord(body) ? body : undefined;
};
