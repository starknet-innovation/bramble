/**
 * Reads a Starknet receipt far enough to check a gasless fee transfer.
 * The live script uses this after `paymaster_executeTransaction`.
 */

import { hash } from "starknet";
import { isRecord } from "../packages/foundation/core/src/json";
import { sameFelt, uint256Felts } from "../packages/foundation/wallet-model/src/networks/networks";

const TRANSFER = hash.getSelectorFromName("Transfer");

const strings = (value: unknown): readonly string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;

const eventsOf = (receipt: unknown): readonly Record<string, unknown>[] => {
  if (!isRecord(receipt)) return [];
  const direct = receipt["events"];
  const inner = isRecord(receipt["receipt"]) ? receipt["receipt"]["events"] : undefined;
  const events = Array.isArray(direct) ? direct : inner;
  if (!Array.isArray(events)) return [];
  return events.filter(isRecord);
};

/**
 * Whether a receipt says the transaction executed successfully.
 * Accepts the JSON-RPC receipt and the starknet.js wrapper around it.
 */
export const receiptSucceeded = (receipt: unknown): boolean => {
  if (!isRecord(receipt)) return false;
  if (receipt["execution_status"] === "SUCCEEDED") return true;
  const inner = receipt["receipt"];
  return isRecord(inner) && inner["execution_status"] === "SUCCEEDED";
};

/**
 * Whether a receipt says the transaction reverted. Pending receipts are neither.
 */
export const receiptReverted = (receipt: unknown): boolean => {
  if (!isRecord(receipt)) return false;
  if (receipt["execution_status"] === "REVERTED") return true;
  const inner = receipt["receipt"];
  return isRecord(inner) && inner["execution_status"] === "REVERTED";
};

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
    const contract = event["from_address"];
    const keys = strings(event["keys"]);
    const data = strings(event["data"]);
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
