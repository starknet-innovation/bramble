/**
 * Strict parsers for extension-only STRK20 wallet journey messages.
 */

import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import { isTransferAmount } from "./message-inputs";

/**
 * Reads the asset and decimal amount requested by the shield composer.
 */
export const readStrk20DepositPreparationInput = (
  message: unknown,
): { readonly amount: string; readonly tokenId: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["amount", "tokenId", "type"]) &&
  message["type"] === "wallet.strk20PrepareDeposit" &&
  isTransferAmount(message["amount"]) &&
  message["amount"].length <= 128 &&
  typeof message["tokenId"] === "string" &&
  message["tokenId"].length > 0 &&
  message["tokenId"].length <= 200
    ? { amount: message["amount"].trim(), tokenId: message["tokenId"] }
    : null;

/**
 * Reads the asset, recipient, and decimal amount for a private-send
 * preparation. The recipient shape is validated as a field element downstream
 * against the canonical helpers; this reader only bounds the raw string.
 */
export const readStrk20TransferPreparationInput = (
  message: unknown,
): { readonly amount: string; readonly recipient: string; readonly tokenId: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["amount", "recipient", "tokenId", "type"]) &&
  message["type"] === "wallet.strk20PrepareTransfer" &&
  isTransferAmount(message["amount"]) &&
  message["amount"].length <= 128 &&
  typeof message["recipient"] === "string" &&
  message["recipient"].length > 0 &&
  message["recipient"].length <= 128 &&
  typeof message["tokenId"] === "string" &&
  message["tokenId"].length > 0 &&
  message["tokenId"].length <= 200
    ? {
        amount: message["amount"].trim(),
        recipient: message["recipient"].trim(),
        tokenId: message["tokenId"],
      }
    : null;

/**
 * Reads the asset, public destination, and decimal amount for an unshield
 * (withdrawal) preparation.
 */
export const readStrk20WithdrawPreparationInput = (
  message: unknown,
): { readonly amount: string; readonly recipient: string; readonly tokenId: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["amount", "recipient", "tokenId", "type"]) &&
  message["type"] === "wallet.strk20PrepareWithdraw" &&
  isTransferAmount(message["amount"]) &&
  message["amount"].length <= 128 &&
  typeof message["recipient"] === "string" &&
  message["recipient"].length > 0 &&
  message["recipient"].length <= 128 &&
  typeof message["tokenId"] === "string" &&
  message["tokenId"].length > 0 &&
  message["tokenId"].length <= 200
    ? {
        amount: message["amount"].trim(),
        recipient: message["recipient"].trim(),
        tokenId: message["tokenId"],
      }
    : null;

/**
 * Reads the address whose privacy-pool registration the send screen checks
 * before enabling a private send.
 */
export const readStrk20RecipientStatusInput = (
  message: unknown,
): { readonly address: string; readonly tokenId: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["address", "tokenId", "type"]) &&
  message["type"] === "wallet.strk20RecipientStatus" &&
  typeof message["address"] === "string" &&
  message["address"].length > 0 &&
  message["address"].length <= 128 &&
  typeof message["tokenId"] === "string" &&
  message["tokenId"].length > 0 &&
  message["tokenId"].length <= 200
    ? { address: message["address"].trim(), tokenId: message["tokenId"] }
    : null;

/**
 * Reads a one-time preparation identifier for final submission.
 */
export const readStrk20WalletExecuteInput = (
  message: unknown,
): { readonly preparationId: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["preparationId", "type"]) &&
  message["type"] === "wallet.strk20Execute" &&
  typeof message["preparationId"] === "string" &&
  /^sha256:[0-9a-f]{64}$/.test(message["preparationId"])
    ? { preparationId: message["preparationId"] }
    : null;
