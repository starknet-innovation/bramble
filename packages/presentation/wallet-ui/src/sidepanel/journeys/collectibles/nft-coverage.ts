/**
 * What the gallery says about the indexer's answer. An incomplete or failed
 * index is stated as such and never shown as "no collectibles": the indexer
 * only suggests, so a gap in its list is not a fact about the account.
 */
import type { NftCoverage } from "../../../popup/responses/responses";

/**
 * The line shown for a list that may not be whole, or null when the indexer
 * answered completely or did not run (only watched NFTs are then claimed).
 */
export const nftCoverageNote = (coverage: NftCoverage): string | null => {
  if (coverage === "incomplete") return "This list may be missing some NFTs.";
  if (coverage === "unavailable")
    return "Couldn't load the NFT list. Only NFTs you watch are shown.";
  return null;
};
