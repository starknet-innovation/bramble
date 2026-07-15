/**
 * Watched NFT metadata kept in plain preferences: contract, token id, network,
 * an optional label, and a spam-hide flag. Pure helpers so the preferences
 * store and its validators share one definition. Ownership is proven over RPC
 * before an NFT is watched; this module only shapes and validates the data.
 */
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import {
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "../starknet/networks";
import { nftId } from "../starknet/nft-metadata";

const MAX_TOKEN_ID_DIGITS = 78;

/**
 * A collectible the user chose to watch in the NFT gallery.
 */
export type WatchedNft = {
  readonly contract: string;
  readonly id: string;
  readonly label?: string;
  readonly networkId: StarknetNetworkId;
  readonly spam?: boolean;
  readonly tokenId: string;
};

const isTokenId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= MAX_TOKEN_ID_DIGITS &&
  /^(?:0|[1-9][0-9]*)$/.test(value);

const isNftLabel = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= 64;

/**
 * Checks a stored watched-NFT record before trusting it.
 */
export const isWatchedNft = (value: unknown): value is WatchedNft =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["contract", "id", "label", "networkId", "spam", "tokenId"]) &&
  typeof value["contract"] === "string" &&
  isNonZeroStarkFieldElement(value["contract"]) &&
  typeof value["id"] === "string" &&
  (value["label"] === undefined || isNftLabel(value["label"])) &&
  isStarknetNetworkId(value["networkId"]) &&
  (value["spam"] === undefined || typeof value["spam"] === "boolean") &&
  isTokenId(value["tokenId"]) &&
  value["id"] === nftId(value["networkId"], value["contract"], value["tokenId"]);

/**
 * Normalizes a watched-NFT input into canonical hex/decimal form and attaches
 * its deterministic id. Callers must validate inputs first.
 */
export const withNftId = (input: Omit<WatchedNft, "id">): WatchedNft => {
  const contract = `0x${BigInt(input.contract).toString(16)}`;
  const tokenId = BigInt(input.tokenId).toString();
  return {
    contract,
    ...(input.label === undefined ? {} : { label: input.label.trim() }),
    id: nftId(input.networkId, contract, tokenId),
    networkId: input.networkId,
    ...(input.spam === undefined ? {} : { spam: input.spam }),
    tokenId,
  };
};
