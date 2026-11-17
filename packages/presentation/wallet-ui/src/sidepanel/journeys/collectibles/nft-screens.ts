/**
 * Routes the collectible screens (the NFTs gallery, watch form, hidden list,
 * detail and send) for the dashboard. Split from app/screens/views.ts to keep
 * it within the size budget. Every screen escapes what it renders.
 */
import type { WalletPreferences } from "@bramble/settings/preferences";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { DiscoveredNft, NftCoverage, WalletStatus } from "../../../popup/responses/responses";
import type { WalletView } from "../../shared/parts";
import { nftSendFlow } from "./nft-send-view";
import { nftDetailFlow, nftGalleryFlow, nftHiddenFlow, nftWatchFlow } from "./nft-views";

/** What the collectible screens read from the dashboard's journey context. */
export type CollectibleScreenContext = {
  readonly account: AccountRef | null;
  readonly discoveredNfts: readonly DiscoveredNft[];
  readonly nftCoverage: NftCoverage;
  readonly preferences: WalletPreferences | null;
  readonly selectedNftId: string | null;
  readonly status: WalletStatus;
};

/** The collectible screen for `activeView`, or null when it is not one. */
export const collectibleJourneyScreen = (
  activeView: WalletView,
  context: CollectibleScreenContext,
): string | null => {
  if (activeView === "nfts") {
    return nftGalleryFlow(
      context.status,
      context.account,
      context.preferences,
      context.discoveredNfts,
      context.nftCoverage,
    );
  }
  if (activeView === "nft-watch") {
    return nftWatchFlow(context.status, context.account);
  }
  if (activeView === "nft-hidden") {
    return nftHiddenFlow(
      context.status,
      context.preferences,
      context.account,
      context.discoveredNfts,
    );
  }
  if (activeView === "nft-detail") {
    return nftDetailFlow(
      context.status,
      context.account,
      context.preferences,
      context.selectedNftId,
      context.discoveredNfts,
    );
  }
  return activeView === "nft-send"
    ? nftSendFlow(
        context.status,
        context.account,
        context.preferences,
        context.selectedNftId,
        context.discoveredNfts,
      )
    : null;
};
