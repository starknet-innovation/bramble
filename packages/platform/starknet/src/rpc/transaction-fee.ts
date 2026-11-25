/**
 * Fee reads for the activity feed: the `actual_fee` a transaction's receipt
 * reports, so a row can show what the account paid rather than the estimate it
 * reviewed. Read once per transaction, after reconciliation has seen it reach
 * an outcome that has a receipt; a missing or malformed fee stays missing.
 */
import { hasOnlyKnownKeys, isRecord, ownField } from "@bramble/core/json";
import { canonicalFelt, isStarkFieldElement } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import { isTransportRpcError, withRpcFallback } from "./provider";
import { TRANSACTION_STATUS_CONCURRENCY, type TransactionStatusInput } from "./transaction-status";

/**
 * The fee a receipt reports, in the unit the chain charged it in: `FRI` for
 * STRK-paid (v3) transactions, `WEI` for ETH-paid legacy ones. `amount` is a
 * canonical hex felt.
 */
export type TransactionFee = {
  readonly amount: string;
  readonly unit: "FRI" | "WEI";
};

/** Checks a stored or reported fee before it is trusted. */
export const isTransactionFee = (value: unknown): value is TransactionFee =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["amount", "unit"]) &&
  (value["unit"] === "FRI" || value["unit"] === "WEI") &&
  typeof value["amount"] === "string" &&
  isStarkFieldElement(value["amount"]) &&
  canonicalFelt(value["amount"]) === value["amount"];

/**
 * Reads the fee from one untrusted receipt. A plain JSON-RPC body and
 * starknet.js's `ReceiptTx` both work, and only own data fields are read, so no
 * getter runs ({@link ownField}). `ReceiptTx` needs no unwrapping: starknet.js
 * copies the body onto it as own fields (and drops it for an unknown
 * `execution_status`, which reads as no fee). Only the RPC 0.7+ shape (`{ amount, unit }`) is accepted; a bare felt carries no unit and
 * is dropped rather than guessed. A missing or malformed fee is undefined.
 */
export const readReceiptFee = (receipt: unknown): TransactionFee | undefined => {
  const fee = ownField(receipt, "actual_fee");
  const unit = ownField(fee, "unit");
  const amount = ownField(fee, "amount");
  const canonical = typeof amount === "string" ? canonicalFelt(amount) : null;
  if (canonical === null || !isStarkFieldElement(canonical) || (unit !== "FRI" && unit !== "WEI")) {
    return undefined;
  }
  return { amount: canonical, unit };
};

const transactionFeeEntry = async (
  provider: RpcProvider,
  transactionHash: string,
): Promise<readonly [string, TransactionFee] | undefined> => {
  try {
    const fee = readReceiptFee(await provider.getTransactionReceipt(transactionHash));
    return fee === undefined ? undefined : [transactionHash, fee];
  } catch (error) {
    if (isTransportRpcError(error)) {
      throw error;
    }
    return undefined;
  }
};

/**
 * Reads receipt fees with the same bounded fan-out and transport failover as
 * status reads. A hash whose receipt is missing, not yet available, or carries
 * no usable fee is simply absent from the result.
 */
export const getTransactionFees = async (
  { hashes, rpcUrls }: TransactionStatusInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<Readonly<Record<string, TransactionFee>>> =>
  withRpcFallback(
    rpcUrls,
    async (provider) => {
      const uniqueHashes = [...new Set(hashes)];
      const entries: (readonly [string, TransactionFee])[] = [];
      for (let offset = 0; offset < uniqueHashes.length; offset += TRANSACTION_STATUS_CONCURRENCY) {
        const batch = uniqueHashes.slice(offset, offset + TRANSACTION_STATUS_CONCURRENCY);
        const results = await Promise.all(
          batch.map((transactionHash) => transactionFeeEntry(provider, transactionHash)),
        );
        entries.push(...results.filter((entry) => entry !== undefined));
      }
      return Object.fromEntries(entries);
    },
    makeProvider,
  );
