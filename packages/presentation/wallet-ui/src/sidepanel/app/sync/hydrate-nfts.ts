/**
 * NFT lanes for the Home NFTs tab and the gallery screens. They run only while
 * one of those is on screen and NFTs are turned on (the default), so the Tokens
 * tab and every other screen read nothing and send no address to an indexer.
 */
import { nftsShown } from "@bramble/settings/preferences";

import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import type { RenderData } from "../rendering/render-cache";
import type { WalletView } from "../screens/views";

// Gallery screens that show collectible data. The watch form needs none.
const NFT_DATA_VIEWS: ReadonlySet<WalletView> = new Set<WalletView>([
  "nfts",
  "nft-hidden",
  "nft-detail",
  "nft-send",
]);

/**
 * Merges indexer candidates with explicit watches. Explicitly watched metadata
 * wins a same-id indexer record: it comes from the wallet's privacy-gated
 * on-chain metadata path rather than the directory.
 */
export const nftSnapshot = (
  indexed: RenderData["indexedNfts"],
  watched: RenderData["watchedNfts"],
): RenderData["discoveredNfts"] => {
  const combined = new Map(indexed.map((nft) => [nft.id, nft]));
  for (const nft of watched) {
    combined.set(nft.id, nft);
  }
  return [...combined.values()];
};

/**
 * Queues the gallery's two lanes when the active view shows collectibles (a
 * gallery screen, or Home with its NFTs tab open) and NFTs are turned on. Watched NFTs and indexer discovery load independently;
 * each re-proves ownership in the background before it reaches the cache.
 */
export const hydrateNfts = (
  input: {
    readonly activeView: WalletView;
    readonly ambient: boolean;
    readonly cache: RenderData;
    readonly status: WalletStatus;
    readonly wallet: Pick<SidepanelWallet, "discoverNfts" | "loadWatchedNfts">;
  },
  fill: <T>(load: () => Promise<T>, assign: (value: T) => void) => void,
): void => {
  const { activeView, cache, status, wallet } = input;
  if (input.ambient || !nftsShown(cache.preferences)) return;
  const homeNfts = activeView === "home" && cache.homeTab === "nfts";
  if (!homeNfts && !NFT_DATA_VIEWS.has(activeView)) return;
  const scope = `${status.networkId}:${status.activeAccountId ?? "none"}`;
  fill(
    () => wallet.loadWatchedNfts(scope),
    (value) => {
      cache.watchedNfts = value;
      cache.discoveredNfts = nftSnapshot(cache.indexedNfts, cache.watchedNfts);
    },
  );
  fill(
    () => wallet.discoverNfts(false, scope),
    (value) => {
      cache.indexedNfts = value.nfts;
      cache.nftCoverage = value.coverage;
      cache.discoveredNfts = nftSnapshot(cache.indexedNfts, cache.watchedNfts);
    },
  );
};
