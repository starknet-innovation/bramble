/**
 * Swap message input readers: strict shapes for the privileged (extension-page
 * only) AVNU swap quote and execute requests. Token ids are resolved against
 * the user's tracked-token registry in the handler — the UI can never smuggle
 * a raw token address through these messages.
 */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { isTransferAmount } from "../routing/message-inputs";

const isQuoteIdText = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9-]{1,120}$/.test(value);

const isTokenIdText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200;

const isSlippage = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 0.05;

/**
 * Parses a swap quote request: an exact sell amount between two TRACKED tokens.
 */
export const readSwapQuoteInput = (
  message: unknown,
): {
  readonly amount: string;
  readonly buyTokenId: string;
  readonly sellTokenId: string;
} | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["amount", "buyTokenId", "sellTokenId", "type"]) &&
  message["type"] === "wallet.swapQuote" &&
  isTransferAmount(message["amount"]) &&
  isTokenIdText(message["sellTokenId"]) &&
  isTokenIdText(message["buyTokenId"])
    ? {
        amount: message["amount"].trim(),
        buyTokenId: message["buyTokenId"],
        sellTokenId: message["sellTokenId"],
      }
    : null;

/**
 * Parses a swap preparation request: the quote to build against plus the
 * display amounts recorded into the activity feed. Preparation performs every
 * remote build and validation step before the user confirms.
 */
export const readSwapPrepareInput = (
  message: unknown,
): {
  readonly amount: string;
  readonly buyAmount: string;
  readonly buyTokenId: string;
  readonly quoteId: string;
  readonly sellTokenId: string;
  readonly slippage: number;
} | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, [
    "amount",
    "buyAmount",
    "buyTokenId",
    "quoteId",
    "sellTokenId",
    "slippage",
    "type",
  ]) &&
  message["type"] === "wallet.swapPrepare" &&
  isTransferAmount(message["amount"]) &&
  isTransferAmount(message["buyAmount"]) &&
  isQuoteIdText(message["quoteId"]) &&
  isTokenIdText(message["sellTokenId"]) &&
  isTokenIdText(message["buyTokenId"]) &&
  (message["slippage"] === undefined || isSlippage(message["slippage"]))
    ? {
        amount: message["amount"].trim(),
        buyAmount: message["buyAmount"].trim(),
        buyTokenId: message["buyTokenId"],
        quoteId: message["quoteId"],
        sellTokenId: message["sellTokenId"],
        slippage: message["slippage"] === undefined ? 0.005 : message["slippage"],
      }
    : null;

/**
 * Parses the final one-time execution claim. No quote, amount, token, or call
 * data is accepted here; all execution material comes from the frozen
 * background preparation the id names.
 */
export const readSwapExecuteInput = (
  message: unknown,
): { readonly preparationId: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["preparationId", "type"]) &&
  message["type"] === "wallet.swapExecute" &&
  typeof message["preparationId"] === "string" &&
  /^sha256:[0-9a-f]{64}$/.test(message["preparationId"])
    ? { preparationId: message["preparationId"] }
    : null;
