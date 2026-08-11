/**
 * Pure parsers for token-management runtime messages from extension pages.
 */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { isNonZeroStarkFieldElement, canonicalAddress } from "@mc-wallet/wallet-model/networks";


/**
 * Parses custom-token add requests carrying a contract address.
 *
 * The address is returned in the one canonical spelling every stored token
 * uses — the zero-padded 64-hex form of the seeded defaults, the curated
 * registry, and the watch-asset boundary — so the metadata read, the stored
 * record, and the derived token id can never disagree about which token this
 * is. Two spellings of one address previously produced two token records whose
 * numerically-equal addresses then failed every private-balance read. A
 * checksummed (mixed-case) paste canonicalizes rather than being rejected; a
 * value that is not a non-zero field element is still refused.
 */
export const readAddTokenInput = (message: unknown): { readonly address: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["address", "type"]) ||
    message["type"] !== "wallet.addToken" ||
    typeof message["address"] !== "string"
  ) {
    return null;
  }
  const address = canonicalAddress(message["address"]);
  return address ? { address } : null;
};

/**
 * Parses token chart requests carrying a contract address.
 */
export const readTokenChartInput = (message: unknown): { readonly address: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["address", "type"]) &&
  message["type"] === "wallet.tokenChart" &&
  typeof message["address"] === "string" &&
  isNonZeroStarkFieldElement(message["address"])
    ? { address: message["address"] }
    : null;

/**
 * Parses token hide/reveal toggles keyed by preference token id.
 */
export const readSetTokenHiddenInput = (
  message: unknown,
): { readonly hidden: boolean; readonly tokenId: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["hidden", "tokenId", "type"]) &&
  message["type"] === "wallet.setTokenHidden" &&
  typeof message["hidden"] === "boolean" &&
  typeof message["tokenId"] === "string" &&
  message["tokenId"].length > 0 &&
  message["tokenId"].length <= 200
    ? { hidden: message["hidden"], tokenId: message["tokenId"] }
    : null;
