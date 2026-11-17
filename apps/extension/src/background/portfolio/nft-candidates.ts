/**
 * Gallery candidate helpers for the NFT handlers: the account's watched NFTs as
 * candidates, their merge with indexer candidates, and the privacy-gated
 * on-chain metadata read for explicit watches only. Split from nft-ops.ts to
 * keep both files within the repository size budget.
 */
import type { DiscoveredNft } from "@bramble/portfolio/nft-metadata";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { WalletOpsDeps } from "../accounts/wallet-ops";

// Bounds how many on-chain metadata reads run at once.
const METADATA_CONCURRENCY = 5;

/** The account's watched, non-spam NFTs on one network, as discovery candidates. */
export const watchedCandidates = (
  preferences: Awaited<ReturnType<WalletOpsDeps["preferencesStore"]["read"]>>,
  networkId: string,
  ownerAddress: string,
): readonly DiscoveredNft[] =>
  (preferences.nfts ?? [])
    .filter(
      (nft) =>
        nft.networkId === networkId &&
        nft.spam !== true &&
        (nft.owner === undefined || sameFelt(nft.owner, ownerAddress)),
    )
    .map((nft) => ({
      collection: "",
      contract: nft.contract,
      id: nft.id,
      image: "",
      name: nft.label ?? "",
      networkId: nft.networkId,
      tokenId: nft.tokenId,
    }));

/** Indexer candidates first, then watched NFTs the indexer did not list. */
export const mergeNftCandidates = (
  indexed: readonly DiscoveredNft[],
  watched: readonly DiscoveredNft[],
): readonly DiscoveredNft[] => {
  const merged = new Map(indexed.map((nft) => [nft.id, nft]));
  for (const nft of watched) {
    if (!merged.has(nft.id)) {
      merged.set(nft.id, nft);
    }
  }
  return [...merged.values()];
};

const enrichWatchedNft = async (
  deps: WalletOpsDeps,
  nft: DiscoveredNft,
  watchedIds: ReadonlySet<string>,
  rpcUrls: readonly string[],
): Promise<DiscoveredNft> => {
  if (!watchedIds.has(nft.id) || !deps.runtimeRpc.getNftMetadata) {
    return nft;
  }
  try {
    const metadata = await deps.runtimeRpc.getNftMetadata({
      contractAddress: nft.contract,
      rpcUrls,
      tokenId: nft.tokenId,
    });
    return metadata === null
      ? nft
      : {
          ...nft,
          ...(metadata.animationUrl ? { animationUrl: metadata.animationUrl } : {}),
          attributes: metadata.attributes,
          collection: metadata.collection || nft.collection,
          description: metadata.description,
          externalUrl: metadata.externalUrl,
          image: metadata.image || nft.image,
          name: metadata.name || nft.name,
        };
  } catch {
    return nft;
  }
};

/**
 * Reads on-chain metadata for explicitly watched NFTs only, in bounded batches;
 * unsolicited indexer candidates never trigger an attacker-controlled read.
 */
export const enrichWatchedNfts = async (
  deps: WalletOpsDeps,
  owned: readonly DiscoveredNft[],
  watchedIds: ReadonlySet<string>,
  rpcUrls: readonly string[],
): Promise<DiscoveredNft[]> => {
  const enriched: DiscoveredNft[] = [];
  for (let start = 0; start < owned.length; start += METADATA_CONCURRENCY) {
    const batch = owned.slice(start, start + METADATA_CONCURRENCY);
    const resolved = await Promise.all(
      batch.map((nft) => enrichWatchedNft(deps, nft, watchedIds, rpcUrls)),
    );
    enriched.push(...resolved);
  }
  return enriched;
};
