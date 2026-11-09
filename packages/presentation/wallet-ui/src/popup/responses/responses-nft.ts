/**
 * Pure validator for the NFT auto-discovery response crossing the background
 * boundary. Kept out of the main `responses` module to hold its line budget;
 * the `DiscoveredNft` shape itself is defined once in the portfolio package
 * and re-exported here so page code has a single import path.
 */
import { hasOnlyKnownKeys, hasUniqueStrings, isJson, isRecord } from "@bramble/core/json";
import type { NftCoverage } from "@bramble/portfolio/nft-indexer";
import { type DiscoveredNft, isDiscoveredNft } from "@bramble/portfolio/nft-metadata";

/**
 * Re-exported discovery coverage so page code has one import path for it.
 */
export type { NftCoverage } from "@bramble/portfolio/nft-indexer";
/**
 * Re-exported discovered-NFT shape so page code has one import path for it.
 */
export type { DiscoveredNft } from "@bramble/portfolio/nft-metadata";

const COVERAGES: readonly unknown[] = ["complete", "incomplete", "none", "unavailable"];

/**
 * Auto-discovered NFTs accepted from the background boundary.
 */
export type DiscoverNftsResponse = {
  readonly coverage?: NftCoverage;
  readonly nfts: readonly DiscoveredNft[];
  readonly ok: true;
};

/**
 * Checks NFT discovery responses before rendering the gallery.
 */
export const isDiscoverNftsResponse = (value: unknown): value is DiscoverNftsResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["coverage", "nfts", "ok"]) &&
  (value["coverage"] === undefined || COVERAGES.includes(value["coverage"])) &&
  value["ok"] === true &&
  Array.isArray(value["nfts"]) &&
  value["nfts"].every(isDiscoveredNft) &&
  hasUniqueStrings(value["nfts"].map((nft) => nft.id));
