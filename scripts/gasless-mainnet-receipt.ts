/**
 * Reads a Starknet receipt far enough to check a gasless fee transfer.
 * The live script uses this after `paymaster_executeTransaction`.
 */

import { hash } from "starknet";
import { sameFelt, uint256Felts } from "../packages/foundation/wallet-model/src/networks/networks";
import { ownField } from "../packages/platform/starknet/src/rpc/receipt-record";

const TRANSFER = hash.getSelectorFromName("Transfer");

const strings = (value: unknown): readonly string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;

// A body field, or the same field on a nested `receipt`. Reads no getters.
const field = (receipt: unknown, key: string): unknown =>
  ownField(receipt, key) ?? ownField(ownField(receipt, "receipt"), key);

const eventsOf = (receipt: unknown): readonly unknown[] => {
  const events = field(receipt, "events");
  return Array.isArray(events) ? events : [];
};

/**
 * Whether a receipt says the transaction executed successfully.
 * Accepts the JSON-RPC body and starknet.js's ReceiptTx.
 */
export const receiptSucceeded = (receipt: unknown): boolean =>
  field(receipt, "execution_status") === "SUCCEEDED";

/**
 * Whether a receipt says the transaction reverted. Pending receipts are neither.
 */
export const receiptReverted = (receipt: unknown): boolean =>
  field(receipt, "execution_status") === "REVERTED";

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
