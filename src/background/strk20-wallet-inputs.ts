/**
 * Strict parsers for extension-only STRK20 wallet journey messages.
 */

import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import { isTransferAmount } from "./message-inputs";

/**
 * The asset, counterparty, and decimal amount every value-moving journey takes.
 */
export type Strk20PreparationInput = {
  readonly amount: string;
  readonly recipient: string;
  readonly tokenId: string;
};

// Shield, private send, and unshield take the identical triple and differ only
// in the message type, so they share one reader — separate copies would let
// their bounds drift apart. The recipient shape is validated as a field element
// downstream against the canonical helpers; this only bounds the raw string.
const readPreparationInput = (message: unknown, type: string): Strk20PreparationInput | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["amount", "recipient", "tokenId", "type"]) &&
  message["type"] === type &&
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
 * Reads the asset, credited recipient, and decimal amount requested by the
 * shield composer.
 *
 * The recipient is required even though a deposit may credit the depositor: the
 * Send flow always knows whose private balance it is crediting, and having no
 * way to omit it is what keeps a payment from silently shielding to the sender.
 */
export const readStrk20DepositPreparationInput = (
  message: unknown,
): Strk20PreparationInput | null => readPreparationInput(message, "wallet.strk20PrepareDeposit");

/**
 * Reads the asset, recipient, and decimal amount for a private-send preparation.
 */
export const readStrk20TransferPreparationInput = (
  message: unknown,
): Strk20PreparationInput | null => readPreparationInput(message, "wallet.strk20PrepareTransfer");

/**
 * Reads the asset, public destination, and decimal amount for an unshield
 * (withdrawal) preparation.
 */
export const readStrk20WithdrawPreparationInput = (
  message: unknown,
): Strk20PreparationInput | null => readPreparationInput(message, "wallet.strk20PrepareWithdraw");

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
