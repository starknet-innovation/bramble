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
