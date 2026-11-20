/**
 * Reads a Starknet receipt far enough to check a gasless fee transfer.
 * The live script uses this after `paymaster_executeTransaction`.
 */

import { hash } from "starknet";
import { ownField } from "../packages/foundation/core/src/json";
import { sameFelt, uint256Felts } from "../packages/foundation/wallet-model/src/networks/networks";

const TRANSFER = hash.getSelectorFromName("Transfer");

// An array's items read as own data fields, so an index getter never runs.
const ownItems = (value: unknown): readonly unknown[] | null =>
  Array.isArray(value)
    ? Array.from({ length: value.length }, (_, i) => ownField(value, String(i)))
    : null;

const strings = (value: unknown): readonly string[] | null => {
  const items = ownItems(value);
  return items?.every((item) => typeof item === "string") ? (items as readonly string[]) : null;
};

// A body field and the same field on a nested `receipt`, in that order.
const fields = (receipt: unknown, key: string): readonly unknown[] => [
  ownField(receipt, key),
  ownField(ownField(receipt, "receipt"), key),
];

const eventsOf = (receipt: unknown): readonly unknown[] =>
  ownItems(fields(receipt, "events").find(Array.isArray)) ?? [];

/**
 * Whether a receipt says the transaction executed successfully.
 * Accepts the JSON-RPC body and starknet.js's ReceiptTx.
 */
export const receiptSucceeded = (receipt: unknown): boolean =>
  fields(receipt, "execution_status").includes("SUCCEEDED");

/**
 * Whether a receipt says the transaction reverted. Pending receipts are neither.
 */
export const receiptReverted = (receipt: unknown): boolean =>
  fields(receipt, "execution_status").includes("REVERTED");

/**
 * Sum of ERC-20 Transfer amounts from `from` to `to` on `token` in one receipt.
 * Null when a matching event's amount is not a uint256.
 */
export const transferredAmount = (
  receipt: unknown,
  token: string,
  from: string,
  to: string,
): bigint | null => {
  let total = 0n;
  let matched = false;
  for (const event of eventsOf(receipt)) {
    const contract = ownField(event, "from_address");
    const keys = strings(ownField(event, "keys"));
    const data = strings(ownField(event, "data"));
    if (typeof contract !== "string" || keys === null || data === null) continue;
    if (!sameFelt(contract, token) || !sameFelt(keys[0] ?? "", TRANSFER)) continue;
    if (!sameFelt(keys[1] ?? "", from) || !sameFelt(keys[2] ?? "", to)) continue;
    const amount = uint256Felts(data[0], data[1]);
    if (amount === null) return null;
    total += amount;
    matched = true;
  }
  return matched ? total : 0n;
};
