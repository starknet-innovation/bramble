/**
 * Pure parsers for token-management runtime messages from extension pages.
 */
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import { isNonZeroStarkFieldElement } from "../starknet/networks";

/**
 * Parses custom-token add requests carrying a contract address.
 */
export const readAddTokenInput = (message: unknown): { readonly address: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["address", "type"]) &&
  message.type === "wallet.addToken" &&
  typeof message.address === "string" &&
  isNonZeroStarkFieldElement(message.address)
    ? { address: message.address }
    : null;

/**
 * Parses token chart requests carrying a contract address.
 */
export const readTokenChartInput = (message: unknown): { readonly address: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["address", "type"]) &&
  message.type === "wallet.tokenChart" &&
  typeof message.address === "string" &&
  isNonZeroStarkFieldElement(message.address)
    ? { address: message.address }
    : null;

/**
 * Parses token hide/reveal toggles keyed by preference token id.
 */
export const readSetTokenHiddenInput = (
  message: unknown,
): { readonly hidden: boolean; readonly tokenId: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["hidden", "tokenId", "type"]) &&
  message.type === "wallet.setTokenHidden" &&
  typeof message.hidden === "boolean" &&
  typeof message.tokenId === "string" &&
  message.tokenId.length > 0 &&
  message.tokenId.length <= 200
    ? { hidden: message.hidden, tokenId: message.tokenId }
    : null;
