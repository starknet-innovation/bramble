/**
 * Pure validator for the NFT auto-discovery response crossing the background
 * boundary. Kept out of the main `responses` module to hold its line budget;
 * the `DiscoveredNft` shape itself is defined once in `starknet/nft-metadata`
 * and re-exported here so page code has a single import path.
 */
import { hasOnlyKnownKeys, hasUniqueStrings, isJson, isRecord } from "../shared/json";
import { type DiscoveredNft, isDiscoveredNft } from "../starknet/nft-metadata";

/**
 * Re-exported discovered-NFT shape so page code has one import path for it.
 */
export type { DiscoveredNft } from "../starknet/nft-metadata";

/**
 * Auto-discovered NFTs accepted from the background boundary.
 */
export type DiscoverNftsResponse = {
  readonly nfts: readonly DiscoveredNft[];
  readonly ok: true;
};

/**
 * Checks NFT discovery responses before rendering the gallery.
 */
export const isDiscoverNftsResponse = (value: unknown): value is DiscoverNftsResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["nfts", "ok"]) &&
  value["ok"] === true &&
  Array.isArray(value["nfts"]) &&
  value["nfts"].every(isDiscoveredNft) &&
  hasUniqueStrings(value["nfts"].map((nft) => nft.id));
