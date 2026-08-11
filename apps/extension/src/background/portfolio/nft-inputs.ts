/**
 * Pure parsers for NFT gallery runtime messages from extension pages.
 */
import { hasOnlyKnownKeys, isRecord, isBaseUnitsAmount } from "@mc-wallet/core/json";

import {
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "@mc-wallet/wallet-model/networks";
import { type FeeEstimate, isFeeEstimate } from "@mc-wallet/starknet/fee-bounds";

const isTokenId = (value: unknown): value is string =>
  isBaseUnitsAmount(value) && value.length <= 78;

/**
 * Fields shared by the add-NFT and transfer-NFT requests.
 */
export type NftTarget = {
  readonly contract: string;
  readonly networkId: StarknetNetworkId;
  readonly tokenId: string;
};

const readNftTarget = (message: Record<string, unknown>): NftTarget | null =>
  typeof message["contract"] === "string" &&
  isNonZeroStarkFieldElement(message["contract"]) &&
  isStarknetNetworkId(message["networkId"]) &&
  isTokenId(message["tokenId"])
    ? {
        contract: message["contract"],
        networkId: message["networkId"],
        tokenId: message["tokenId"],
      }
    : null;

/**
 * Parses a watch-NFT request; ownership is proven over RPC before it is stored.
 */
export const readAddNftInput = (
  message: unknown,
): (NftTarget & { readonly label?: string }) | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["contract", "label", "networkId", "tokenId", "type"]) ||
    message["type"] !== "wallet.addNft"
  ) {
    return null;
  }
  const target = readNftTarget(message);
  if (!target) {
    return null;
  }
  if (message["label"] !== undefined) {
    if (
      typeof message["label"] !== "string" ||
      message["label"].trim().length === 0 ||
      message["label"].trim().length > 64
    ) {
      return null;
    }
    return { ...target, label: message["label"].trim() };
  }
  return target;
};

type NftTransferMessageType = "wallet.reviewNftTransfer" | "wallet.transferNft";

/**
 * A parsed NFT send or send-review request: the target NFT, the recipient, and
 * — on a send the panel has already reviewed — the fee estimate that review
 * displayed, which the background turns into a signing ceiling (MCW-V09-119).
 */
export type NftTransferRequest = NftTarget & {
  readonly recipient: string;
  readonly reviewedFee?: FeeEstimate;
};

const readNftTransferInput = (
  message: unknown,
  messageType: NftTransferMessageType,
): NftTransferRequest | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, [
      "contract",
      "networkId",
      "recipient",
      "reviewedFee",
      "tokenId",
      "type",
    ]) ||
    message["type"] !== messageType ||
    typeof message["recipient"] !== "string" ||
    !isNonZeroStarkFieldElement(message["recipient"]) ||
    (message["reviewedFee"] !== undefined && !isFeeEstimate(message["reviewedFee"]))
  ) {
    return null;
  }
  const target = readNftTarget(message);
  return target
    ? {
        ...target,
        recipient: message["recipient"],
        ...(isFeeEstimate(message["reviewedFee"]) ? { reviewedFee: message["reviewedFee"] } : {}),
      }
    : null;
};

/**
 * Parses an NFT transfer-review request. Review is read-only; the background
 * still re-parses and re-proves the same fields on the later submit request.
 */
export const readReviewNftTransferInput = (message: unknown): NftTransferRequest | null =>
  readNftTransferInput(message, "wallet.reviewNftTransfer");

/**
 * Parses a send-NFT request through the verified invoke path.
 */
export const readTransferNftInput = (message: unknown): NftTransferRequest | null =>
  readNftTransferInput(message, "wallet.transferNft");

/**
 * Parses an NFT discovery request. `includeWatched` defaults to true for the
 * complete legacy response; the side panel sets it false when its watched-NFT
 * fast lane is already loading those records independently.
 */
export const readDiscoverNftsInput = (
  message: unknown,
): { readonly includeWatched: boolean; readonly multisigId?: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["includeWatched", "multisigId", "type"]) ||
    message["type"] !== "wallet.discoverNfts" ||
    (message["includeWatched"] !== undefined && typeof message["includeWatched"] !== "boolean") ||
    (message["multisigId"] !== undefined &&
      (typeof message["multisigId"] !== "string" ||
        message["multisigId"].length === 0 ||
        message["multisigId"].length > 200))
  ) {
    return null;
  }
  return {
    includeWatched: message["includeWatched"] !== false,
    ...(typeof message["multisigId"] === "string" ? { multisigId: message["multisigId"] } : {}),
  };
};

/**
 * Parses a remove-NFT request that targets a watched NFT by its id.
 */
export const readRemoveNftInput = (message: unknown): { readonly id: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["id", "type"]) &&
  message["type"] === "wallet.removeNft" &&
  typeof message["id"] === "string" &&
  message["id"].length > 0 &&
  message["id"].length <= 200
    ? { id: message["id"] }
    : null;

/**
 * Parses a set-NFT-indexer-URL request. The URL is shape-validated (custom RPC
 * rules) in the preferences store; an empty string clears the endpoint.
 */
export const readSetNftIndexerUrlInput = (message: unknown): { readonly url: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["type", "url"]) &&
  message["type"] === "wallet.setNftIndexerUrl" &&
  typeof message["url"] === "string" &&
  message["url"].length <= 2048
    ? { url: message["url"] }
    : null;

/**
 * Parses a spam-hide toggle for a watched NFT.
 */
export const readSetNftSpamInput = (
  message: unknown,
): { readonly id: string; readonly spam: boolean } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["id", "spam", "type"]) &&
  message["type"] === "wallet.setNftSpam" &&
  typeof message["id"] === "string" &&
  message["id"].length > 0 &&
  message["id"].length <= 200 &&
  typeof message["spam"] === "boolean"
    ? { id: message["id"], spam: message["spam"] }
    : null;
